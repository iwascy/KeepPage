FROM golang:1.24-alpine AS builder

WORKDIR /src
COPY apps/api-go/go.mod apps/api-go/go.sum ./
RUN go mod download
COPY apps/api-go/ ./
RUN CGO_ENABLED=0 go build -o /out/keeppage-api-go ./cmd/server \
  && CGO_ENABLED=0 go build -o /out/keeppage-migrate ./cmd/migrate

FROM alpine:3.21

RUN apk add --no-cache ca-certificates curl
RUN adduser -D -H keeppage
USER keeppage
WORKDIR /app
COPY --from=builder /out/keeppage-api-go /app/keeppage-api-go
COPY --from=builder /out/keeppage-migrate /app/keeppage-migrate
EXPOSE 8787
ENTRYPOINT ["sh", "-c", "if [ \"$STORAGE_DRIVER\" = \"postgres\" ]; then /app/keeppage-migrate; fi; exec /app/keeppage-api-go"]
