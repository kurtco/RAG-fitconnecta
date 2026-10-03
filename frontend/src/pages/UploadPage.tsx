import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { DocumentView } from '../types'
import { EmptyState, ErrorState, Loading } from '../components/States'

export default function UploadPage() {
  const [documents, setDocuments] = useState<DocumentView[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadOk, setUploadOk] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadDocuments = useCallback(async () => {
    setListError(null)
    try {
      const data = await api<{ documents: DocumentView[] }>('/documents')
      setDocuments(data.documents)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load documents')
    }
  }, [])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  async function handleUpload(event: FormEvent) {
    event.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    setUploadOk(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const data = await api<{ document: DocumentView }>('/documents', { method: 'POST', body: form })
      setUploadOk(`"${data.document.filename}" processed · ${data.document.chunkCount} chunk(s) indexed`)
      if (fileRef.current) fileRef.current.value = ''
      await loadDocuments()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Documents</h1>
        <Link to="/chat" className="btn primary">
          Go to assistant →
        </Link>
      </div>

      <form onSubmit={handleUpload} className="card form">
        <label>
          Upload a document (.txt or .pdf, max 10MB)
          <input ref={fileRef} type="file" accept=".txt,.pdf,text/plain,application/pdf" required />
        </label>
        <button type="submit" className="btn primary" disabled={uploading}>
          {uploading ? 'Uploading & indexing…' : 'Upload'}
        </button>
        {uploading && <Loading label="Parsing, chunking and embedding your document…" />}
        {uploadError && <ErrorState message={uploadError} />}
        {uploadOk && (
          <p className="ok-message" role="status">
            ✓ {uploadOk}
          </p>
        )}
      </form>

      <h2>Your documents</h2>
      {listError && <ErrorState message={listError} onRetry={() => void loadDocuments()} />}
      {!listError && documents === null && <Loading label="Loading documents…" />}
      {documents?.length === 0 && (
        <EmptyState
          title="No documents yet"
          hint="Upload a .txt or .pdf file above. The assistant will answer questions grounded in your documents, with citations."
        />
      )}
      {documents && documents.length > 0 && (
        <table className="card table">
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Chunks</th>
              <th>Size</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.filename}</td>
                <td>
                  <span className={`badge badge-${doc.status}`}>{doc.status}</span>
                  {doc.status === 'failed' && doc.errorDetail && (
                    <span className="error-detail" title={doc.errorDetail}>
                      {' '}
                      — {doc.errorDetail}
                    </span>
                  )}
                </td>
                <td>{doc.chunkCount}</td>
                <td>{(doc.sizeBytes / 1024).toFixed(1)} KB</td>
                <td>{new Date(doc.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
