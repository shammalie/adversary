# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build
WORKDIR /src/apps/api

RUN apk add --no-cache git ca-certificates

COPY apps/api/go.mod apps/api/go.sum* ./
RUN go mod download

COPY apps/api/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/geoseed ./cmd/geoseed

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget \
 && adduser -D -H -u 65532 nonroot
USER nonroot:nonroot
WORKDIR /app
COPY --from=build /out/api /app/api
COPY --from=build /out/migrate /app/migrate
COPY --from=build /out/geoseed /app/geoseed
EXPOSE 8080
ENTRYPOINT ["/app/api"]
CMD ["serve"]
