# Secrets handling (SPEC I2/I4).
#
# Where AI API keys live: AWS Secrets Manager, injected into the backend
# container at runtime via the ECS task definition `secrets` block
# (valueFrom). Keys never appear in images, task definition plaintext,
# logs, or the repository.
#
# Rotation:
# - DB credentials: AWS-managed automatic rotation (45 days) below.
# - OPENAI_API_KEY: OpenAI has no AWS-managed rotation lambda. Production
#   runbook = dual-key rotation: create new key in OpenAI dashboard,
#   put-secret-value, rolling redeploy (ECS), revoke old key. Zero downtime.
#   (Explained in README §Infrastructure.)
# - JWT_SECRET: same dual-value rotation procedure; tokens signed with the
#   old secret expire naturally (8h TTL).

resource "aws_secretsmanager_secret" "openai_api_key" {
  name_prefix             = "${var.environment}/ai-docs/openai-api-key-"
  recovery_window_in_days = 7
  description             = "OpenAI API key for LLM + embeddings"
}

resource "aws_secretsmanager_secret_version" "openai_api_key" {
  secret_id = aws_secretsmanager_secret.openai_api_key.id
  # Placeholder value; real key is set out-of-band via CLI/console so it
  # never touches git or terraform state:
  #   aws secretsmanager put-secret-value --secret-id <id> --secret-string '{"OPENAI_API_KEY":"sk-..."}'
  secret_string = jsonencode({ OPENAI_API_KEY = "REPLACE-OUT-OF-BAND" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name_prefix             = "${var.environment}/ai-docs/jwt-secret-"
  recovery_window_in_days = 7
  description             = "JWT signing secret"
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = jsonencode({ JWT_SECRET = "REPLACE-OUT-OF-BAND" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Automatic rotation for the RDS master credentials (AWS-managed lambda).
resource "aws_secretsmanager_secret_rotation" "db" {
  secret_id = aws_db_instance.main.master_user_secret[0].secret_arn

  rotation_rules {
    automatically_after_days = 45
  }
}
