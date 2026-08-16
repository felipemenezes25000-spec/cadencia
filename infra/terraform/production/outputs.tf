output "ecr_repository_uri" { value = aws_ecr_repository.app.repository_url }
output "ecs_cluster" { value = aws_ecs_cluster.main.name }
output "ecs_api_service" { value = aws_ecs_service.api.name }
output "ecs_worker_service" { value = aws_ecs_service.worker.name }
output "ecs_api_container" { value = "api" }
output "ecs_worker_container" { value = "worker" }
output "ecs_migration_task_definition" { value = aws_ecs_task_definition.migration.family }
output "ecs_migration_container" { value = "migration" }
output "ecs_private_subnets" { value = join(",", var.private_subnet_ids) }
output "ecs_security_groups" { value = join(",", var.ecs_security_group_ids) }
output "production_api_url" { value = var.production_api_url }
output "alb_dns_name" { value = aws_lb.api.dns_name }
output "rds_endpoint" { value = aws_db_instance.postgres.endpoint }
output "rds_master_secret_arn" {
  value     = try(aws_db_instance.postgres.master_user_secret[0].secret_arn, null)
  sensitive = true
}
output "storage_bucket" { value = aws_s3_bucket.objects.bucket }
output "storage_kms_key_arn" { value = aws_kms_key.data.arn }
output "alarm_topic_arn" { value = aws_sns_topic.alarms.arn }
