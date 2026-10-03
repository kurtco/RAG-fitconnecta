variable "aws_region" {
  description = "AWS region for all resources (data residency consideration, see README)"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name"
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "backend_image" {
  description = "ECR image URI for the backend task"
  type        = string
}

variable "frontend_image" {
  description = "ECR image URI for the frontend (nginx) task"
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "desired_backend_tasks" {
  description = "Initial number of backend Fargate tasks"
  type        = number
  default     = 2
}
