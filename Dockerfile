FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web-builder
WORKDIR /src/internal/monitor/web
COPY internal/monitor/web/package.json internal/monitor/web/package-lock.json ./
RUN npm ci
COPY internal/monitor/web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.25 AS builder
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
ARG GOPROXY=https://proxy.golang.org,direct
RUN go env -w GOPROXY=${GOPROXY} && go mod download
COPY . .
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown
COPY --from=web-builder /src/internal/monitor/assets ./internal/monitor/assets
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -trimpath \
    -tags "with_utls with_quic with_grpc with_wireguard with_gvisor with_clash_api" \
    -ldflags "-s -w -X easy-proxies/internal/version.Version=${VERSION} -X easy-proxies/internal/version.Commit=${COMMIT} -X easy-proxies/internal/version.BuildTime=${BUILD_TIME}" \
    -o easy-proxies ./cmd/easy-proxies

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/logs
WORKDIR /app
COPY --from=builder /src/easy-proxies /app/easy-proxies
COPY config.example.yaml /app/config.example.yaml
COPY nodes.example /app/nodes.example
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
# Pool/Hybrid mode: 2323, Management: 9091, Multi-port/Hybrid mode: 24000-24200
EXPOSE 2323 9091 24000-24200
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["--config", "/app/config.yaml"]
