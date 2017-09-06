PATH := $(PWD)/node_modules/.bin:$(PATH)

.PHONY: install test clean serve build all

all: build serve

./node_modules/:
	npm install

webroot/client.pack.js: client.js ./node_modules/
	webpack $< $@

webroot/client.pack.min.js: webroot/client.pack.js ./node_modules/
	minify $< -o $@

key.pem:
	openssl genpkey -algorithm RSA -outform pem -out $@ -pkeyopt rsa_keygen_bits:4096 -pkeyopt rsa_keygen_pubexp:65537

install: ./node_modules/

build: webroot/client.pack.min.js

test:
	mocha **/test_*.js

serve: ./node_modules/ key.pem
	node ./server.js key.pem highscore < words

clean:
	rm -fv key.pem webroot/client.pack.min.js webroot/client.pack.js
