# RDS PostgreSQL 16 with pgvector support (aws_rds extension available).
# Storage encrypted at rest; credentials auto-managed in Secrets Manager.
resource "aws_db_subnet_group" "main" {
  name_prefix = "${var.environment}-db-"
  subnet_ids  = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier_prefix = "${var.environment}-aidocs-"
  engine            = "postgres"
  engine_version    = "16.4"
  instance_class    = var.db_instance_class
  allocated_storage = 20

  db_name  = "aidocs"
  username = "app"
  # Master password managed by Secrets Manager (automatic rotation, see secrets.tf)
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  storage_encrypted = true
  multi_az        = var.environment == "prod"
  publicly_accessible = false

  backup_retention_period = 7
  skip_final_snapshot     = var.environment != "prod"

  # pgvector is installed by the application schema (infra/db/init.sql: CREATE EXTENSION vector)
}
