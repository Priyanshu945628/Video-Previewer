/**
 * Cloudflare zone — DNS, WAF rules, page rules.
 *
 *   - api.<domain> proxied → origin (NLB / Ingress IP)
 *   - <domain>     proxied → web origin
 *   - WAF: bot fight mode on; rate-limit /auth/login, /shares/*, /stream/*
 *   - Page rules: disable CF cache for /stream/* (signed URLs!)
 */
variable "domain"     { type = string }
variable "api_origin" { type = string }
variable "web_origin" { type = string }

data "cloudflare_zone" "this" { name = var.domain }

resource "cloudflare_record" "api" {
  zone_id = data.cloudflare_zone.this.id
  name    = "api"
  type    = "CNAME"
  value   = var.api_origin
  proxied = true
  ttl     = 1
}

resource "cloudflare_record" "web" {
  zone_id = data.cloudflare_zone.this.id
  name    = "@"
  type    = "CNAME"
  value   = var.web_origin
  proxied = true
  ttl     = 1
}

# Don't cache signed-URL endpoints — every request must hit origin.
resource "cloudflare_page_rule" "stream_bypass" {
  zone_id  = data.cloudflare_zone.this.id
  target   = "api.${var.domain}/stream/*"
  priority = 1
  actions {
    cache_level = "bypass"
    disable_apps = true
  }
}

# Aggressive rate limit on login attempts.
resource "cloudflare_rate_limit" "login" {
  zone_id      = data.cloudflare_zone.this.id
  threshold    = 5
  period       = 60
  match {
    request {
      url_pattern = "api.${var.domain}/auth/login"
      schemes     = ["HTTPS"]
      methods     = ["POST"]
    }
  }
  action { mode = "challenge", timeout = 600 }
}
