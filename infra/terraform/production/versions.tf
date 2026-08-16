terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 7.0"
    }
  }

  # O bucket/lock do state e bootstrap separado. Passe -backend-config no init.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Application = "cadencia"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}
