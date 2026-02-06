const axios = require("axios");

setInterval(async () => {
  try {
    const { data } = await axios.get("https://ipinfo.io/json", { timeout: 8000 });
    console.log("NORMAL:", data.ip, data.country);
  } catch (e) {
    console.log("NORMAL ERR:", e.message);
  }
}, 5000);
