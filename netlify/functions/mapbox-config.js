exports.handler = async function () {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || "";
  return {
    statusCode: token ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(token ? { token } : { error: "Mapbox token is not configured." })
  };
};
