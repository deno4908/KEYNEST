import { createHmac } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";

const text = z.string().min(1).max(200);
const generated = z.object({
  billId: text,
  qrAccount: text,
  qrCode: z.string().min(20).max(4096),
});
const bill = z.object({
  billId: text,
  qrAccount: text,
  bankBin: text,
  vaAccountNumber: text,
  qrCodeType: z.literal("dynamic-one-time-payment"),
  amount: z.number().int().positive(),
  totalAmountPaid: z.number().int().nonnegative(),
  status: text,
});
const historyPage = z.object({
  totalCount: z.number().int().nonnegative().safe(),
  items: z.array(z.object({
    transactionId: text,
    accountNumber: text,
    bankBin: text,
    amount: z.number().int().positive().safe(),
    type: z.enum(['CREDIT','DEBIT']),
    transactionTime: z.string().datetime({offset:true}),
    description: z.string().max(5000),
  })).max(100),
});
export const STATIC_MONITOR_MS = 7 * 24 * 3600000;
export function staticPaymentCode(description) {
  // Reject partial codes and transfers mentioning multiple different orders.
  const codes = [...new Set((description.toUpperCase().match(/\bKN[A-F0-9]{16}\b/g) || []))];
  return codes.length === 1 ? codes[0] : null;
}
export const tingeeReady = (c) =>
  !!(
    c?.clientId &&
    c.secret &&
    /^\d{6}$/.test(c.bankBin || "") &&
    (c.qrMode === 'static' ? /^\d{6,20}$/.test(c.accountNumber || '') : c.vaAccount) &&
    c.accountName
  );
const tingeeBankName = (bin) => bin === '970436' ? 'VCB' : bin;
export function tingeeTimestamp(now = Date.now()) {
  return new Date(now + 7 * 3600000).toISOString().replace(/[-:TZ.]/g, "");
}
// Log only known labels / short numeric provider codes, never response bodies,
// request headers, validation input or arbitrary exception messages.
export function tingeeFailureCode(error) {
  if (error instanceof z.ZodError) return "tingee_invalid_response";
  const message = error?.message;
  return typeof message === "string" &&
    /^(?:tingee_(?:timeout|network_error|invalid_response|history_page_limit|bill_mismatch|rejected(?:_\d{1,6})?|http_[1-5]\d{2}(?:_code_\d{1,6})?)|payment_expiring)$/.test(
      message,
    )
    ? message
    : "tingee_unexpected_error";
}
export function createTingeeClient(config, fetcher = fetch) {
  async function call(path, data) {
    const body = JSON.stringify({
      ...(config.merchantId ? { merchantId: config.merchantId } : {}),
      ...data,
    });
    const timestamp = tingeeTimestamp();
    const response = await fetcher(`${config.baseUrl}/v1/${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        "x-client-id": config.clientId,
        "x-request-timestamp": timestamp,
        "x-signature": createHmac("sha512", config.secret)
          .update(`${timestamp}:${body}`)
          .digest("hex"),
      },
      body,
    }).catch((error) => {
      throw new Error(
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "tingee_timeout"
          : "tingee_network_error",
      );
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        response.ok
          ? "tingee_invalid_response"
          : `tingee_http_${response.status}`,
      );
    }
    const code =
      typeof result?.code === "string" && /^\d{1,6}$/.test(result.code)
        ? result.code
        : null;
    if (!response.ok)
      throw new Error(
        `tingee_http_${response.status}${code ? "_code_" + code : ""}`,
      );
    if (result?.code !== "00")
      throw new Error(`tingee_rejected${code ? "_" + code : ""}`);
    return result.data;
  }
  return {
    async generate(payment) {
      if (config.qrMode === 'static') {
        // Check history permission before showing a QR that we cannot reconcile.
        historyPage.parse(await call('transaction/get-paging', {
          filter:payment.code,skipCount:0,maxResultCount:1,
          bankBin:config.bankBin,
          startTime:tingeeTimestamp(Date.parse(payment.created_at)).slice(0,14),
          endTime:tingeeTimestamp().slice(0,14),
        }));
        const data=z.object({qrCode:z.string().min(20).max(4096)}).parse(await call('generate-viet-qr', {
          bankBin:config.bankBin,accountNumber:config.accountNumber,amount:payment.amount,content:payment.code,
        }));
        return {
          provider:'tingee',qr_kind:'static',bill_id:null,qr_account:config.accountNumber,
          qr_image:await QRCode.toDataURL(data.qrCode,{errorCorrectionLevel:'M',margin:4,width:400}),
          expires_at:payment.expires_at,bank:tingeeBankName(config.bankBin),bank_bin:config.bankBin,
          va_account:null,account:config.accountNumber,account_name:config.accountName,
        };
      }
      const started = Date.now();
      const minutes = Math.floor(
        (Date.parse(payment.expires_at) - started) / 60000,
      );
      if (minutes < 1) throw new Error("payment_expiring");
      const data = generated.parse(
        await call("generate-dynamic-qr", {
          vaAccountNumber: config.vaAccount,
          bankBin: config.bankBin,
          qrCodeType: "dynamic-one-time-payment",
          amount: payment.amount,
          purpose: payment.code,
          expireInMinute: minutes,
          extraInfo: payment.id,
        }),
      );
      return {
        provider: "tingee",
        qr_kind: "dynamic",
        bill_id: data.billId,
        qr_account: data.qrAccount,
        expires_at: new Date(started + minutes * 60000).toISOString(),
        qr_image: await QRCode.toDataURL(data.qrCode, {
          errorCorrectionLevel: "M",
          margin: 4,
          width: 400,
        }),
        bank: tingeeBankName(config.bankBin),
        bank_bin: config.bankBin,
        va_account: config.vaAccount,
        account: data.qrAccount,
        account_name: config.accountName,
      };
    },
    async transactions(route) {
      const start=Date.parse(route.payment.created_at);
      const end=Math.min(Date.now(),Date.parse(route.payment.expires_at)+STATIC_MONITOR_MS);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end<start || end-start>10*24*3600000)
        throw new Error('tingee_invalid_response');
      const items=[];
      for (let skip=0;skip<300;skip+=100) {
        const page=historyPage.parse(await call('transaction/get-paging', {
          filter:route.payment.code,skipCount:skip,maxResultCount:100,
          bankBin:route.bank_bin,
          startTime:tingeeTimestamp(start).slice(0,14),endTime:tingeeTimestamp(end).slice(0,14),
        }));
        items.push(...page.items);
        if (skip+page.items.length>=page.totalCount) return items.filter(t=>
          t.type==='CREDIT' && t.accountNumber===route.account && t.bankBin===route.bank_bin &&
          Date.parse(t.transactionTime)>=Math.floor(start/1000)*1000 && Date.parse(t.transactionTime)<=end &&
          staticPaymentCode(t.description)===route.payment.code);
        if (page.items.length<100) throw new Error('tingee_invalid_response');
      }
      // Do not declare a scan complete or close a route when pages were omitted.
      throw new Error('tingee_history_page_limit');
    },
    async status(route) {
      const result = await call("get-status-dynamic-qr", {
        qrAccount: route.qr_account,
        billId: route.bill_id,
      });
      const data = bill.parse(result.billInfo);
      if (
        data.billId !== route.bill_id ||
        data.qrAccount !== route.qr_account ||
        data.bankBin !== route.bank_bin ||
        data.vaAccountNumber !== route.va_account ||
        data.amount !== route.payment.amount
      )
        throw new Error("tingee_bill_mismatch");
      return data;
    },
    remove: (route) =>
      call("delete-dynamic-qr", {
        qrAccount: route.qr_account,
        billId: route.bill_id,
      }),
  };
}
