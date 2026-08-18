# POC deployment

This deployment runs the contract-review frontend, Node.js backend,
PostgreSQL, and ONLYOFFICE Document Server. It uses the PostgreSQL vector
store so the review workflow does not depend on a separate Milvus cluster.

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
openssl rand -hex 32
openssl passwd -apr1
```

Put the first generated value into `POSTGRES_PASSWORD` and the second into
`ONLYOFFICE_JWT_SECRET` in `deploy/poc.env`. Save the password hash from the
third command as a line such as `review:<hash>` in
`deploy/.htpasswd`. Both files are ignored by Git.

Set `APP_HOST` to the browser-visible service URL. Fill in the OpenAI-compatible
`LLM_*` variables before expecting real AI review output. Set
`ONLYOFFICE_PUBLIC_URL` to the browser-visible Document Server URL, normally
`http://<server-ip>:8081/`. The JWT secret is shared by the backend and
Document Server through the compose configuration.

## 3. Start and verify

```bash
docker compose --env-file deploy/poc.env -f docker-compose.poc.yml config --quiet
docker compose --env-file deploy/poc.env -f docker-compose.poc.yml up -d --build --wait
docker compose --env-file deploy/poc.env -f docker-compose.poc.yml ps
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8081/healthcheck
```

The application endpoint is port `8080` and ONLYOFFICE is port `8081` by
default. Set `APP_PORT` or `ONLYOFFICE_PORT` when different host ports are
required. Both ports must be reachable by trial users.

## POC boundaries

- Nginx basic authentication protects the shared trial endpoint, but it is not
  a replacement for a production account, role, and audit system.
- Only files from the configured knowledge base are used when
  `REVIEW_KB_ONLY_MODE=true`.
- Use HTTPS, enterprise identity, backups, monitoring, and dependency
  remediation before production use.
