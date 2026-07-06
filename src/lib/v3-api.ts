import { NextRequest, NextResponse } from "next/server";

export function getRequestId(request: NextRequest) {
  return request.headers.get("x-request-id")?.trim() || `v2-${crypto.randomUUID()}`;
}

export function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export function authorizeV3Api(request: NextRequest) {
  const expectedToken = process.env.V2_API_TOKEN?.trim();
  if (!expectedToken) {
    return null;
  }

  const authorization = request.headers.get("authorization")?.trim() || "";
  const expectedAuthorization = `Bearer ${expectedToken}`;
  if (authorization === expectedAuthorization) {
    return null;
  }

  const requestId = getRequestId(request);
  return withRequestId(
    NextResponse.json(
      { requestId, message: "Unauthorized" },
      { status: 401 },
    ),
    requestId,
  );
}
