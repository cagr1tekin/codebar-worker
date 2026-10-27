# CodeBar Worker — Deploy Adımları

## 1. Bağımlılıkları kur
```bash
cd codebar-worker
npm install
```

## 2. Secret'ları ayarla (bir kere çalıştır)
```bash
# JWT imzalama anahtarı (rastgele, uzun bir string gir)
npm run secret:jwt
# > Enter a secret value: buraya-cok-uzun-rastgele-bir-sifre-yaz

# Store claim şifreleme anahtarı
npm run secret:claim
# > Enter a secret value: buraya-baska-bir-uzun-rastgele-sifre-yaz
```

## 3. D1 veritabanını oluştur (sadece ilk seferinde)
```bash
npm run db:migrate
```

## 4. Local test
```bash
npm run dev
# → http://localhost:8787
```

## 5. Deploy
```bash
npm run deploy
# → https://codebar-worker.KULLANICIADIN.workers.dev
```

## 6. Custom domain (opsiyonel)
Cloudflare Dashboard → Workers → codebar-worker → Settings → Domains & Routes
→ Add Custom Domain: api.codebar.com

---

## İlk süper admin kullanıcısı oluşturma

Deploy sonrası bir kere çalıştır:

```bash
curl -X POST https://codebar-worker.KULLANICIADIN.workers.dev/admin/check-claim \
  -H "Content-Type: application/json" \
  -d '{"claimToken": "STORE_CLAIM_TOKEN"}'
```

Önce mağaza oluşturmak için doğrudan D1'e yaz:
```bash
wrangler d1 execute codebar-db --command "INSERT INTO stores (id, name) VALUES ('STORE_UUID', 'Mağaza Adı');"
```
