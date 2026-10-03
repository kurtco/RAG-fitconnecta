terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # Production would use a remote backend with state locking:
  # backend "s3" {
  #   bucket         = "finconecta-tfstate"
  #   key            = "ai-docs-assessment/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ai-document-assistant"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
