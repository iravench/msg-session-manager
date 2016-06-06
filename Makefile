SHORT_NAME        ?= manager
PROJECT           ?= iravench/msg-session-$(SHORT_NAME)
TAG               ?= latest

ifdef REGISTRY
    IMAGE=$(REGISTRY)/$(PROJECT):$(TAG)
  else
    IMAGE=$(PROJECT):$(TAG)
  endif

REGISTRY_ADDR = $(shell docker-machine ip infra):5000
PRIVATE_IMAGE = $(REGISTRY_ADDR)/$(shell basename $(IMAGE))

all:
	@echo "available targets:"
	@echo "  * clean     - remove images of name $(PROJECT)"
	@echo "  * build     - build a docker image of the name $(IMAGE) from Dockerfile"
	@echo "  * registry  - build a docker image of the name $(IMAGE) then push it to local private registry"
	@echo "  * up        - run local compile version of $(PROJECT)"
	@echo "  * up_prof   - run local compile version of $(PROJECT) for profiling"
	@echo "  * profile   - process make up_prof's profiling results into readable text"
clean:
	docker images | grep "$(PROJECT)" | grep "$(TAG)" | awk '{print $$3}' | (read id; if [ "$$id" != "" ]; then docker rmi $$id; exit 0; fi)
build: Dockerfile clean
	npm run compile
	docker build -t $(IMAGE) .
registry: build
	docker tag -f $(IMAGE) $(PRIVATE_IMAGE)
	docker push $(PRIVATE_IMAGE)
	docker rmi -f $(IMAGE)
	docker rmi -f $(PRIVATE_IMAGE)
up:
	npm run compile
	node ./lib/index.js
up_prof:
	npm run compile
	node --prof ./lib/index.js
profile:
	rm profile.txt || true
	node --prof-process isolate*-v8.log > profile.txt
	rm isolate*-v8.log
	vim profile.txt
FORCE:
