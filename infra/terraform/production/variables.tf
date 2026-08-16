variable "aws_region" {
  type    = string
  default = "sa-east-1"
}

variable "name_prefix" {
  type    = string
  default = "cadencia-prod"
}

variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "alb_security_group_ids" { type = list(string) }
variable "ecs_security_group_ids" { type = list(string) }
variable "rds_security_group_ids" { type = list(string) }
variable "certificate_arn" { type = string }
variable "production_api_url" { type = string }

variable "bootstrap_image" {
  description = "Imagem existente usada no primeiro apply; os deploys posteriores usam SHA imutavel."
  type        = string
}

variable "postgres_engine_version" {
  description = "Versao de PostgreSQL suportada pelo RDS na conta/regiao (ex.: major 18 quando disponivel)."
  type        = string
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 100
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "api_cpu" {
  type    = number
  default = 1024
}

variable "api_memory" {
  type    = number
  default = 2048
}

variable "worker_cpu" {
  type    = number
  default = 1024
}

variable "worker_memory" {
  type    = number
  default = 2048
}

variable "api_secrets" {
  description = "Mapa NOME_ENV => ARN do Secrets Manager para a API."
  type        = map(string)
  sensitive   = true
}

variable "worker_secrets" {
  description = "Mapa NOME_ENV => ARN do Secrets Manager para o worker."
  type        = map(string)
  sensitive   = true
}

variable "migration_secrets" {
  description = "Mapa NOME_ENV => ARN; deve conter DATABASE_URL_ADMIN e segredos exigidos pelas migrations."
  type        = map(string)
  sensitive   = true
}

variable "alarm_email" {
  description = "Email opcional para confirmar assinatura SNS dos alarmes."
  type        = string
  default     = null
  nullable    = true
}
