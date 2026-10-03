output "alb_dns_name" {
  description = "Point your DNS CNAME at this ALB"
  value       = aws_lb.main.dns_name
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "rds_endpoint" {
  description = "Private RDS endpoint (no public access)"
  value       = aws_db_instance.main.address
}

output "db_secret_arn" {
  description = "Secrets Manager ARN holding DB credentials (auto-rotated)"
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "openai_key_secret_arn" {
  description = "Secrets Manager ARN for the OpenAI key (dual-key rotation runbook in README)"
  value       = aws_secretsmanager_secret.openai_api_key.arn
}
