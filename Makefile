
build:
	@npm install

release: 
	@npm install
	@vsce publish

increase-patch:
	@echo "Increase patch/minor/major version"
	@npm version patch 