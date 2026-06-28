/**
 * VSP — root Terraform module.
 *
 * Layout: one provider stack per concern. We split because they belong to
 * different lifecycles (R2 buckets live a long time; Neon branches don't),
 * and so a destroy on the app stack can't take the data with it.
 *
 *   modules/r2          object storage
 *   modules/neon        Postgres (or RDS if you prefer)
 *   modules/upstash     Redis
 *   modules/cloudflare  DNS, WAF, page rules
 *   modules/k8s_app     namespace, secrets, ingress
 *
 * Backend is Terraform Cloud — swap for S3+DynamoDB if you want pure AWS.
 */
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.40" }
    neon       = { source = "kislerdm/neon",         version = "~> 0.7" }
    upstash    = { source = "upstash/upstash",       version = "~> 1.5" }
    kubernetes = { source = "hashicorp/kubernetes",  version = "~> 2.31" }
  }

  backend "remote" {
    organization = "your-org"
    workspaces { name = "vsp-prod" }
  }
}

variable "domain"      { type = string }
variable "environment" { type = string, default = "prod" }

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

module "r2" {
  source      = "./modules/r2"
  environment = var.environment
}

module "neon" {
  source      = "./modules/neon"
  environment = var.environment
}

module "upstash" {
  source      = "./modules/upstash"
  environment = var.environment
}

module "cloudflare" {
  source      = "./modules/cloudflare"
  domain      = var.domain
  api_origin  = "api.${var.domain}"
  web_origin  = var.domain
}

output "database_url" { value = module.neon.connection_url, sensitive = true }
output "redis_url"    { value = module.upstash.redis_url,   sensitive = true }
output "s3_endpoint"  { value = module.r2.s3_endpoint }
output "buckets"      { value = module.r2.buckets }
