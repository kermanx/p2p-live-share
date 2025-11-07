# Stage 1: Build
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache bash git

WORKDIR /build

COPY go.mod go.sum* ./

RUN go mod download

COPY . .

RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o ws-server

# Stage 2: Runtime
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /build/ws-server .

EXPOSE 80

CMD ["./ws-server", "--port", "80"]
