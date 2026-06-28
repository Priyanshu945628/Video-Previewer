/**
 * Cloudflare R2 buckets. Four buckets, all private:
 *   - originals     uploaded masters (resumable multipart)
 *   - hls           transcoded variants + encrypted segments
 *   - thumbs        poster + sprite + diff strip
 *   - exports       review-export PDFs / JSONs
 *
 * Lifecycle rules:
 *   - aborted multiparts cleaned after 24h
 *   - exports auto-purge after 14d (the row TTL we set in the API)
 */
variable "environment" { type = string }
variable "cf_account_id" { type = string }

locals {
  buckets = ["originals", "hls", "thumbs", "exports"]
  prefix  = "vsp-${var.environment}"
}

resource "cloudflare_r2_bucket" "this" {
  for_each   = toset(local.buckets)
  account_id = var.cf_account_id
  name       = "${local.prefix}-${each.key}"
  location   = "WNAM"
}

output "buckets" {
  value = { for k, b in cloudflare_r2_bucket.this : k => b.name }
}

output "s3_endpoint" {
  value = "https://${var.cf_account_id}.r2.cloudflarestorage.com"
}
