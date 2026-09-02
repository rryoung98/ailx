# Infrastructure

GCP: Cloud Run + global external ALB + Cloud Armor, Cloud SQL (Postgres, Enterprise), 4 GCS buckets behind Cloud CDN, Cloud Tasks pipeline spine, Vertex AI regional endpoints. CI/CD via GitHub Actions + Workload Identity Federation. See spec §11.

The live configuration is Terraform in the PRIVATE `ailx-backend` repo, not here. What it
is set to, what a request costs, and what warm capacity would cost are written down in
`docs/LOAD-TEST.md`.
