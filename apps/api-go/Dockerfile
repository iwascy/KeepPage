FROM golang:1.23-alpine AS builder

WORKDIR /src
COPY apps/api-go/go.mod apps/api-go/go.sum* ./
RUN go mod download
COPY apps/api-go/ ./
RUN go build -o /out/keeppage-api-go ./cmd/server
RUN go build -o /out/keeppage-migrate ./cmd/migrate

FROM alpine:3.21

RUN adduser -D -H keeppage
USER keeppage
WORKDIR /app
COPY --from=builder /out/keeppage-api-go /app/keeppage-api-go
COPY --from=builder /out/keeppage-migrate /app/keeppage-migrate
EXPOSE 8788
ENTRYPOINT ["sh", "-c", "if [ \"$STORAGE_DRIVER\" = \"postgres\" ]; then /app/keeppage-migrate; fi; exec /app/keeppage-api-go"]
