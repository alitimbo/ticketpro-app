export type IpayPaymentType = "mobile" | "nita_online" | "amanata";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "cancelled";
export type FulfillmentStatus = "pending" | "fulfilled" | "failed";

export type PaymentOrder = {
  order_id: string;
  transaction_id: string;
  purchaser_type: "organization" | "reseller";
  plan: {
    id: string;
    code: string;
    name: string;
    router_limit: number;
    max_devices: number;
    duration_days: number;
    price_cfa: number;
  };
  amount: number;
  currency: "XOF";
  country: "NE";
  msisdn: string;
  payment_type: IpayPaymentType;
  status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  provider_public_reference: string | null;
  license_id: string | null;
  license_key?: string;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  failure_reason: string | null;
};

export type InitiatedPaymentOrder = {
  order: PaymentOrder;
  order_token: string;
  payment: {
    reference: string;
    public_reference: string;
    meta_data: { code?: string } | null;
  };
};

const apiUrl = String(import.meta.env.VITE_LICENSE_API_URL ?? "").replace(/\/$/, "");

export async function initiateOrganizationPayment(input: {
  planId: string;
  msisdn: string;
  customerName: string;
  paymentType: IpayPaymentType;
}): Promise<InitiatedPaymentOrder> {
  return post("/v1/payments/orders/organization", {
    plan_id: input.planId,
    msisdn: input.msisdn,
    customer_name: input.customerName,
    payment_type: input.paymentType
  });
}

export async function initiateResellerPayment(input: {
  planId: string;
  msisdn: string;
  paymentType: IpayPaymentType;
  resellerSessionToken: string;
}): Promise<InitiatedPaymentOrder> {
  return post(
    "/v1/reseller/payments/orders",
    {
      plan_id: input.planId,
      msisdn: input.msisdn,
      payment_type: input.paymentType
    },
    input.resellerSessionToken
  );
}

export async function getPaymentOrderStatus(input: {
  orderId: string;
  orderToken: string;
  resellerSessionToken?: string;
}): Promise<{ order: PaymentOrder }> {
  return post(
    "/v1/payments/orders/status",
    {
      order_id: input.orderId,
      order_token: input.orderToken
    },
    input.resellerSessionToken
  );
}

async function post<T>(
  pathname: string,
  body: Record<string, unknown>,
  bearerToken?: string
): Promise<T> {
  if (!apiUrl) throw new Error("L'API TicketPro n'est pas configurée (VITE_LICENSE_API_URL).");
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Erreur de paiement (${response.status}).`);
  return payload;
}
