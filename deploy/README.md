# POC deployment

This deployment runs the contract-review frontend, Node.js backend, and
PostgreSQL behind one Nginx endpoint. It uses PostgreSQL vector fallback to
keep the trial footprint small. Milvus and OnlyOffice are not started by this
compose file.

## 1. Check the Docker network range

Before starting Docker on an enterprise network, compare the host routes with
Docker's configured address pools:

```bash
ip route
sudo cat /etc/docker/daemon.json 2>/dev/null || true
```

Do not use Docker's default `172.17.0.0/16` bridge when the host or management
network already uses that range. Configure a non-overlapping `bip` and
`default-address-pools` range, then restart Docker.

## 2. Create the private runtime files

```bash
cp deploy/poc.env.example deploy/poc.env
openssl rand -hex 24
openssl passwd -apr1
```

Put the generated database password into `deploy/poc.env`. Save the password
hash from the second command as a line such as `review:<hash>` in
`deploy/.htpasswd`. Both files are ignored by Git.

Set `APP_HOST` to the browser-visible service URL. Fill in the OpenAI-compatible
`LLM_*` variables before expecting real AI review output. Embedding and rerank
services are optional for a UI and workflow POC.

## 3. Start and verify

```bash
docker compose -f docker-compose.poc.yml config --quiet
docker compose -f docker-compose.poc.yml up -d --build --wait
docker compose -f docker-compose.poc.yml ps
curl -fsS http://127.0.0.1:8080/healthz
```

The browser endpoint is port `8080` by default. Set `APP_PORT` when a different
host port is required.

## POC boundaries

- Nginx basic authentication protects the shared trial endpoint, but it is not
  a replacement for a production account, role, and audit system.
- Only files from the configured knowledge base are used when
  `REVIEW_KB_ONLY_MODE=true`.
- Use HTTPS, enterprise identity, backups, monitoring, dependency remediation,
  and a supported document-preview service before production use.
