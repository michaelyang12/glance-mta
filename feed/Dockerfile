FROM golang:1.23-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o mta-arrivals ./main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/mta-arrivals .
COPY config.yaml .
COPY data/ data/

EXPOSE 8080
CMD ["./mta-arrivals"]
