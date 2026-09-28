export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { phone, amount, reference = "CoastBitez" } = req.body || {};

    if (!phone || !Number.isInteger(Number(amount)) || Number(amount) < 1) {
      return res.status(400).json({ error: "Valid phone and amount are required." });
    }

    const normalized = String(phone).replace(/\s|[-()]/g, "").replace(/^\+254/, "254").replace(/^0/, "254");
    if (!/^254(?:7|1)\d{8}$/.test(normalized)) {
      return res.status(400).json({ error: "Use a valid Kenyan M-Pesa number." });
    }

    const consumerKey = process.env.DARAJA_CONSUMER_KEY;
    const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
    const shortcode = process.env.DARAJA_SHORTCODE;
    const passkey = process.env.DARAJA_PASSKEY;
    const callbackUrl = process.env.DARAJA_CALLBACK_URL;
    const environment = (process.env.DARAJA_ENV || "sandbox").toLowerCase();

    if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) {
      return res.status(500).json({ error: "Daraja server configuration is incomplete." });
    }

    const base = environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

    const auth = Buffer.from(consumerKey + ":" + consumerSecret).toString("base64");
    const tokenResponse = await fetch(base + "/oauth/v1/generate?grant_type=client_credentials", {
      headers: { Authorization: "Basic " + auth }
    });
    const tokenText = await tokenResponse.text();
    if (!tokenResponse.ok) {
      return res.status(502).json({ error: "Daraja authorization failed.", details: tokenText.slice(0, 500) });
    }
    const tokenData = JSON.parse(tokenText);

    const timestamp = new Date().toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    const password = Buffer.from(String(shortcode) + passkey + timestamp).toString("base64");

    const stkPayload = {
      BusinessShortCode: Number(shortcode),
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Number(amount),
      PartyA: Number(normalized),
      PartyB: Number(shortcode),
      PhoneNumber: Number(normalized),
      CallBackURL: callbackUrl,
      AccountReference: String(reference).slice(0, 12),
      TransactionDesc: "Coast Bitez order"
    };

    const stkResponse = await fetch(base + "/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tokenData.access_token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(stkPayload)
    });

    const stkText = await stkResponse.text();
    let data;
    try { data = JSON.parse(stkText); } catch { data = { raw: stkText }; }

    if (!stkResponse.ok) {
      return res.status(502).json({ error: "Daraja rejected the payment request.", details: data });
    }

    return res.status(200).json({
      ok: true,
      message: "M-Pesa prompt request sent.",
      checkoutRequestId: data.CheckoutRequestID || null,
      customerMessage: data.CustomerMessage || data.ResponseDescription || "Check your phone for the M-Pesa prompt."
    });
  } catch (error) {
    return res.status(500).json({ error: "Payment request failed.", details: error.message });
  }
}
