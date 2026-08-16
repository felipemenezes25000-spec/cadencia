data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

locals {
  all_secret_arns = distinct(concat(values(var.api_secrets), values(var.worker_secrets), values(var.migration_secrets)))

  common_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "CADENCIA_ENV", value = "production" },
    { name = "CADENCIA_PROVIDERS", value = "real" },
    { name = "STORAGE_DRIVER", value = "s3" },
    { name = "STORAGE_S3_BUCKET", value = aws_s3_bucket.objects.bucket },
    { name = "STORAGE_KMS_KEY_ID", value = aws_kms_key.data.arn },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "LOG_LEVEL", value = "info" },
  ]
}

resource "aws_kms_key" "data" {
  description             = "Cadencia production data encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "data" {
  name          = "alias/${var.name_prefix}-data"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_s3_bucket" "objects" {
  bucket_prefix = "${var.name_prefix}-objects-"
}

resource "aws_s3_bucket_versioning" "objects" {
  bucket = aws_s3_bucket.objects.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "objects" {
  bucket = aws_s3_bucket.objects.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "objects" {
  bucket                  = aws_s3_bucket.objects.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "objects" {
  bucket = aws_s3_bucket.objects.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.objects.arn,
          "${aws_s3_bucket.objects.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
      {
        Sid       = "RequireKmsForWrites"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.objects.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption" = "aws:kms"
          }
        }
      },
      {
        Sid       = "RequireCadenciaKmsKey"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.objects.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption-aws-kms-key-id" = aws_kms_key.data.arn
          }
        }
      },
    ]
  })
}

resource "aws_ecr_repository" "app" {
  name                 = "${var.name_prefix}-app"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier                      = "${var.name_prefix}-postgres"
  engine                          = "postgres"
  engine_version                  = var.postgres_engine_version
  instance_class                  = var.db_instance_class
  allocated_storage               = var.db_allocated_storage_gb
  max_allocated_storage           = 1000
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.data.arn
  db_name                         = "cadencia"
  username                        = "cadencia_admin"
  manage_master_user_password     = true
  multi_az                        = true
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = var.rds_security_group_ids
  publicly_accessible             = false
  backup_retention_period         = 35
  copy_tags_to_snapshot           = true
  deletion_protection             = true
  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.data.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.name_prefix}-final"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/cadencia/production/api"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/cadencia/production/worker"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "migration" {
  name              = "/cadencia/production/migration"
  retention_in_days = 365
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${var.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  count = length(local.all_secret_arns) == 0 ? 0 : 1
  name  = "secrets"
  role  = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue", "kms:Decrypt"]
      Resource = concat(local.all_secret_arns, [aws_kms_key.data.arn])
    }]
  })
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task_storage" {
  name = "storage"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.objects.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.data.arn
      }
    ]
  })
}

resource "aws_ecs_cluster" "main" {
  name = var.name_prefix
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_lb" "api" {
  name                       = substr("${var.name_prefix}-api", 0, 32)
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = var.alb_security_group_ids
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "api" {
  name        = substr("${var.name_prefix}-api", 0, 32)
  port        = 3001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_wafv2_web_acl" "api" {
  name  = "${var.name_prefix}-api"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "cadencia-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit"
    priority = 20
    action {
      block {}
    }
    statement {
      rate_based_statement {
        aggregate_key_type = "IP"
        limit              = 3000
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "cadencia-rate"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "cadencia-api-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = aws_lb.api.arn
  web_acl_arn  = aws_wafv2_web_acl.api.arn
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.api_cpu)
  memory                   = tostring(var.api_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name      = "api"
    image     = var.bootstrap_image
    essential = true
    portMappings = [{ containerPort = 3001, hostPort = 3001, protocol = "tcp" }]
    environment = local.common_environment
    secrets     = [for name, arn in var.api_secrets : { name = name, valueFrom = arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "api"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.worker_cpu)
  memory                   = tostring(var.worker_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name      = "worker"
    image     = var.bootstrap_image
    essential = true
    command   = ["pnpm", "--filter", "@cadencia/worker", "exec", "tsx", "src/worker.ts"]
    environment = local.common_environment
    secrets     = [for name, arn in var.worker_secrets : { name = name, valueFrom = arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "${var.name_prefix}-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name      = "migration"
    image     = var.bootstrap_image
    essential = true
    command   = ["pnpm", "db:migrate"]
    environment = local.common_environment
    secrets     = [for name, arn in var.migration_secrets : { name = name, valueFrom = arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migration.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "migration"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.api_desired_count
  launch_type                       = "FARGATE"
  enable_execute_command            = false
  health_check_grace_period_seconds = 60
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = var.ecs_security_group_ids
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  depends_on = [aws_lb_listener.https]
  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_ecs_service" "worker" {
  name                   = "worker"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.worker.arn
  desired_count          = var.worker_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = var.ecs_security_group_ids
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_sns_topic" "alarms" {
  name              = "${var.name_prefix}-alarms"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.name_prefix}-alb-5xx"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix }
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "healthy_hosts" {
  alarm_name          = "${var.name_prefix}-healthy-hosts"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  dimensions = {
    LoadBalancer = aws_lb.api.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
  alarm_actions = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_cpu" {
  alarm_name          = "${var.name_prefix}-api-cpu"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.api.name
  }
  alarm_actions = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "worker_cpu" {
  alarm_name          = "${var.name_prefix}-worker-cpu"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.worker.name
  }
  alarm_actions = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.name_prefix}-rds-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.identifier }
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${var.name_prefix}-rds-free-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 21474836480
  comparison_operator = "LessThanOrEqualToThreshold"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.identifier }
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
