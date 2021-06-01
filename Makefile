URI		:= auth-dev.mozilla.auth0.com
CLIENTID	:= 
CLIENTSECRET	:=

all:
	@echo 'Available make targets:'
	@grep '^[^#[:space:]].*:' Makefile

python-venv: venv
venv:
	$(shell [ -d venv ] || python3 -m venv venv)
	echo "# Run this in your shell to activate:"
	echo "source venv/bin/activate"

install:
	pip install -r requirements.txt


deploy-local:
	# Requires a credentials.json file to be present and valid
	# Useful for local tests
	uploader_rules.py -r rules

deploy-stage:
	@echo "Deploying to Auth0 stage instace in: $(URI)"
	uploader_rules.py -r rules -u $(URI) -i $(CLIENTID) -s $(CLIENTSECRET)

deploy-prod:
	@echo "Deploying to Auth0 Production instance in: $(URI)"
	uploader_rules.py -r rules -u $(URI) -i $(CLIENTID) -s $(CLIENTSECRET)


.PHONY: venv all install deploy
