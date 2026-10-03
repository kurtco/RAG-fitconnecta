resource "aws_ecs_cluster" "main" {
  name = "${var.environment}-ai-docs"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.environment}/ai-docs-backend"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/${var.environment}/ai-docs-frontend"
  retention_in_days = 30
}

# --- IAM: least privilege ---
# Execution role: pull images, write logs, read the app secrets. Nothing else.
resource "aws_iam_role" "task_execution" {
  name_prefix = "${var.environment}-ai-docs-exec-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "read_app_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.openai_api_key.arn,
        aws_secretsmanager_secret.jwt_secret.arn,
        aws_db_instance.main.master_user_secret[0].secret_arn,
      ]
    }]
  })
}

# Task role: the app itself needs NO AWS API access (DB via network,
# OpenAI via public endpoint through NAT). Empty policy = zero permissions.
resource "aws_iam_role" "task" {
  name_prefix = "${var.environment}-ai-docs-task-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# --- Task definition ---
locals {
  db_secret_arn = aws_db_instance.main.master_user_secret[0].secret_arn

  backend_container = jsonencode([{
    name      = "backend"
    image     = var.backend_image
    essential = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "LLM_PROVIDER", value = "openai" },
      { name = "OPENAI_CHAT_MODEL", value = "gpt-4o-mini" },
      { name = "OPENAI_EMBEDDING_MODEL", value = "text-embedding-3-small" },
      { name = "PROMPT_VERSION", value = "v1" },
      { name = "RATE_LIMIT_WINDOW_MS", value = "60000" },
      { name = "RATE_LIMIT_MAX", value = "60" },
    ]
    # Secrets injected at runtime, never in plaintext config:
    secrets = [
      { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.openai_api_key.arn}:OPENAI_API_KEY::" },
      { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.jwt_secret.arn}:JWT_SECRET::" },
      { name = "DATABASE_URL", valueFrom = local.db_secret_arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.backend.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "backend"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
      interval    = 15
      timeout     = 3
      retries     = 3
      startPeriod = 10
    }
  }])

  frontend_container = jsonencode([{
    name      = "frontend"
    image     = var.frontend_image
    essential = true
    portMappings = [{ containerPort = 80, protocol = "tcp" }]
    dependsOn   = [{ containerName = "backend", condition = "HEALTHY" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.frontend.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "frontend"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.environment}-ai-docs-backend"
  container_definitions    = local.backend_container
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn
}

resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.environment}-ai-docs-frontend"
  container_definitions    = local.frontend_container
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn
}

# --- Services ---
resource "aws_ecs_service" "backend" {
  name            = "backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_backend_tasks
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.backend.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 3000
  }
}

resource "aws_ecs_service" "frontend" {
  name            = "frontend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.backend.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = 80
  }
}

# --- ALB with path-based routing: /api -> backend, everything else -> frontend ---
resource "aws_lb" "main" {
  name_prefix        = "${substr(var.environment, 0, 6)}-aid"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "backend" {
  name_prefix = "${substr(var.environment, 0, 6)}-be-"
  vpc_id      = aws_vpc.main.id
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "frontend" {
  name_prefix = "${substr(var.environment, 0, 6)}-fe-"
  vpc_id      = aws_vpc.main.id
  port        = 80
  protocol    = "HTTP"
  target_type = "ip"

  health_check {
    path                = "/"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # Production: redirect to HTTPS with an ACM certificate listener on 443.
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

variable "acm_certificate_arn" {
  description = "ACM certificate for the ALB HTTPS listener"
  type        = string
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern { values = ["/api/*", "/health"] }
  }
}

# --- Autoscaling: bursty AI usage (SPEC I4) ---
resource "aws_appautoscaling_target" "backend" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = 2
  max_capacity       = 10
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${var.environment}-backend-cpu"
  service_namespace  = aws_appautoscaling_target.backend.service_namespace
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 65.0
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}
