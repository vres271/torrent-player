const axios = require("axios");

setInterval(async () => {
  try {
    const { data } = await axios.get("https://ipinfo.io/json", { timeout: 8000 });
    console.log("VPN:", data.ip, data.country);
  } catch (e) {
    console.log("VPN ERR:", e.message);
  }
}, 5000);
