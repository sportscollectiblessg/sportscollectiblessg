// Supabase Edge Function: track-package
//
// Securely proxies parcel tracking requests to Ship24's API. The Ship24 API
// key lives only here as a server-side secret (SHIP24_API_KEY) and is never
// exposed to the browser.
//
// Deploy with: supabase functions deploy track-package
// Set the secret with: supabase secrets set SHIP24_API_KEY=your_key_here
//
// Called from the frontend as:
//   supabase.functions.invoke('track-package', { body: { trackingNumber, courier } })

const STATUS_LABELS: Record<string, string> = {
  info_received: "Info received",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  failed_attempt: "Delivery attempt failed",
  available_for_pickup: "Ready for pickup",
  delivered: "Delivered",
  exception: "Exception",
  pending: "Pending",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { trackingNumber } = await req.json();

    if (!trackingNumber) {
      return json({ error: "Missing trackingNumber." }, 400);
    }

    const apiKey = Deno.env.get("SHIP24_API_KEY");
    if (!apiKey) {
      return json({ error: "Server is not configured with a Ship24 API key yet." }, 500);
    }

    // "Create a tracker and get results" registers the number AND returns
    // its current status in one call, and is idempotent — safe to call
    // repeatedly with the same tracking number. We deliberately don't pass
    // courierCode: Ship24's auto-detection is documented as reliable, and
    // an incorrect explicit code could override a correct auto-detection.
    const res = await fetch("https://api.ship24.com/public/v1/trackers/track", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trackingNumber }),
    });

    let payload;
    try {
      payload = await res.json();
    } catch {
      return json({ error: `Ship24 returned an unreadable response (HTTP ${res.status}) — this can happen when a usage quota or rate limit is exceeded.` }, 502);
    }

    if (!res.ok) {
      return json({ error: payload?.message || payload?.error?.message || `Ship24 couldn't process this tracking number (HTTP ${res.status}).` }, 502);
    }

    // Response shape read defensively — Ship24's docs confirm the
    // statusMilestone/events field names, but the exact wrapping envelope
    // for /trackers/track wasn't independently confirmed, so we check a
    // couple of plausible paths rather than assuming just one.
    const tracking =
      payload?.data?.trackings?.[0] ??
      payload?.trackings?.[0] ??
      payload?.data?.[0] ??
      null;

    if (!tracking) {
      return json({ status: "pending", statusText: "Registered — awaiting first update from carrier" });
    }

    const shipment = tracking.shipment || tracking;
    const events = tracking.events || shipment.events || [];
    const latestEvent = Array.isArray(events) && events.length > 0 ? events[0] : null;

    const status = shipment.statusMilestone || latestEvent?.statusMilestone || "unknown";

    // Best-effort origin/destination — field names for this aren't fully
    // confirmed from Ship24's docs, so we check a few plausible spots and
    // simply omit it if none match rather than showing something wrong.
    const origin =
      shipment.originCountryCode || shipment.origin?.country || tracking.originCountryCode || null;
    const destination =
      shipment.destinationCountryCode || shipment.destination?.country || tracking.destinationCountryCode || null;

    return json({
      status,
      statusText: STATUS_LABELS[status] || status,
      lastEvent: latestEvent?.status || null,
      lastUpdate: latestEvent?.occurrenceDatetime || null,
      origin,
      destination,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
