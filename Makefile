# All targets run inside Docker. None touch the host Python interpreter.

.PHONY: up up-backend down test lint typecheck licenses rebuild

# Build (if needed) and start the full stack (backend + frontend).
up:
	docker compose up --build

# Build and start only the backend service.
up-backend:
	docker compose up --build backend

# Stop and remove the stack.
down:
	docker compose down

# Tests / lint / type / licenses run in the backend image with the [dev] toolset
# added on the fly (the deploy image ships lean, without dev deps). The intake
# floor is pinned to 640 (compose disables it for the app's soft-warn UX).
test:
	docker compose run --rm --no-deps -e TTB_MIN_IMAGE_LONG_EDGE=640 backend \
		sh -c "pip install -q '.[dev]' && pytest -q"

lint:
	docker compose run --rm --no-deps backend \
		sh -c "pip install -q '.[dev]' && ruff check backend scripts tests"

typecheck:
	docker compose run --rm --no-deps backend \
		sh -c "pip install -q '.[dev]' && mypy backend scripts"

licenses:
	docker compose run --rm --no-deps backend \
		sh -c "pip install -q '.[dev]' && python -m scripts.check_licenses"

# Rebuild from scratch: prune dangling images/volumes, then no-cache build.
rebuild:
	docker image prune -f
	docker volume prune -f
	docker compose build --no-cache
