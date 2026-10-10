# Sledy Top-Up | Sèvè peman otomatik

Sèvè sa a fè 4 bagay: kreye peman MonCash, verifye si lajan an rive vre, pwoteje pri yo, epi montre w kisa pou livre.
Li pa bezwen `npm install`. Li mande **Node.js 18 oswa plis**.

## Sa ki mache kounye a
- **MonCash:** peman otomatik, ak verifikasyon sou sèvè a.
- **NatCash:** **pa disponib**. Sit la kache NatCash otomatikman jiskaske ou ajoute yon adaptè (mande Natcom dokimantasyon API machann nan).
- **Non kont Free Fire:** li mande yon founisè (`PLAYER_LOOKUP_URL`). Si ou pa mete l, sit la di kliyan an pou l verifye ID a li menm epi li kite l kontinye.

## 4 etap pou aktive l
1. **Kle MonCash.** Nan pòtal MonCash Business, kreye yon aplikasyon (Gateway/Button) epi pran `Client ID` ak `Client Secret`. Anrejistre adrès retou a: `https://yourdomain.com/` (paj prensipal sit ou a). Kòmanse ak **sandbox**.
2. **Konfigirasyon.** Kopye `.env.example` sou `.env` epi ranpli l (kle yo, `ALLOWED_ORIGIN` = adrès sit ou, `ADMIN_TOKEN` = yon mo sekrè long). Pa janm pibliye `.env`.
3. **Mete sèvè a sou entènèt ak HTTPS.** Egzanp: Render, Railway, Fly.io oswa yon VPS ak Nginx. Kòmand: `node server.js`. Mete menm varyab `.env` yo nan paramèt lokal la.
4. **Konekte sit la.** Nan `index.html`, nan blòk `CONFIG`, mete `API:'https://api.yourdomain.com'` (adrès sèvè a) epi `DEMO:false`.

Teste ak sandbox anvan. Lè tout bagay bon, chanje `MONCASH_MODE=live` ak kle live yo.

## Kijan li mache
`Kliyan klike Peye` → sit la voye atik yo bay `/pay` → **sèvè a kalkile pri a** (li pa fè konfyans montan navigatè a voye) → MonCash kreye peman an → kliyan an peye sou paj MonCash → MonCash retounen l sou sit la ak `transactionId` → sit la rele `/verify` → sèvè a mande MonCash si lajan an rive, si montan an bon epi si `transactionId` la pa janm itilize anvan → sèvè a reponn `paid:true` → kòmand lan vin "Resevwa".

Si yon moun eseye reitilize menm `transactionId`, sèvè a reponn `duplicate:true` (avètisman nan 3yèm tantativ, bloke nan 5yèm sou sit la).

## Kisa pou livre (trè enpòtan)
Sit la pa livre dyaman oswa kont Netflix poukont li. Lè yon peman konfime:
- sèvè a ekri l nan `data/payments.json` epi nan jounal la (`[PAID]`);
- si ou mete `NOTIFY_WEBHOOK`, li voye w yon mesaj;
- ou ka wè lis la: `curl -H "x-admin-token: TOKEN_OU" https://api.yourdomain.com/admin/payments`
- apre ou fin livre: `POST /admin/delivered` ak `{"payId":"..."}`.

## Limit ou dwe konnen
- **Kont kliyan yo, balans ak kòmand yo toujou sove nan navigatè a.** Peman an verifye vre sou sèvè a, men balans wallet la ka toujou modifye pa yon moun ki konnen kòman. Pou rezoud sa, kont yo ak balans yo dwe vin sou sèvè a (pwochen etap).
- Fichye `data/payments.json` bon pou kòmanse. Lè w gen anpil kliyan, chanje l pou yon baz done (PostgreSQL, SQLite).
- Kòd la pa t teste ak vrè MonCash (mwen pa gen kle ou). Mwen teste l ak yon MonCash fo (`dev/mock-moncash.js`). Si adrès API MonCash yo diferan, chanje yo ak `MONCASH_API_BASE` ak `MONCASH_GATEWAY_BASE`.
- Voye resi a sou WhatsApp otomatikman mande WhatsApp Business API.

## Tès lokal (opsyonèl)
```
node dev/mock-moncash.js     # MonCash fo sou :9100
MONCASH_CLIENT_ID=id MONCASH_CLIENT_SECRET=secret MONCASH_API_BASE=http://localhost:9100/Api MONCASH_GATEWAY_BASE=http://localhost:9100/gw ALLOWED_ORIGIN=* node server.js
```
