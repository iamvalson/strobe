.PHONY: dev build docker-up docker-down


dev:
	docker compose up -d
	go run ./cmd/server/main.go


docker-up:
	docker compose up -d


docker-down:
	docker compose down


build:
	go build -o bin/strobe ./cmd/server/main.go

run:
	go run ./cmd/server/main.go