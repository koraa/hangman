PATH := $(PWD)/node_modules/.bin:$(PATH)

.PHONY: install test clean serve build all

all: build serve

./node_modules/:
	npm install

webroot/client.pack.js: client.js
	webpack $< $@

webroot/client.pack.min.js: webroot/client.pack.js
	minify $< -o $@

key.pem:
	openssl genpkey -algorithm RSA -outform pem -out $@ -pkeyopt rsa_keygen_bits:4096 -pkeyopt rsa_keygen_pubexp:65537

install: ./node_modules/

build: webroot/client.pack.min.js

test:
	mocha **/test_*.js

serve: ./node_modules/ key.pem
	echo -e '3dhubs\nmarvin\nprint\nfilament\norder\nlayer' | node ./server.js key.pem highscore

clean:
	rm -fv key.pem webroot/client.pack.min.js webroot/client.pack.js
