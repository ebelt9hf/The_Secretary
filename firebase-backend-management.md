# Secretary: Firebase Cloud Vault Management & Monetization Guide

This guide explains how your Firebase project (`secretary-98cdd`) operates, how to manage users, and how to introduce paid access when you are ready.

---

## 1. How It Operates Today (Free Open Mode)

1. **Zero-Knowledge Encryption**:
   - All notes, titles, tags, and content are encrypted with **AES-256-GCM** client-side on the user's computer before reaching Firebase.
   - Your Firebase Realtime Database only stores encrypted ciphertext blobs (`ciphertext`, `iv`, `tag`). Neither Firebase nor anyone else can read the notes.
2. **Anonymous Authentication**:
   - When a user opens Secretary with Cloud Sync, Secretary signs in anonymously via Firebase Auth (`signInAnonymously`).
   - Each device gets a unique user ID (`auth.uid`).
3. **Multi-Device Pairing**:
   - Devices pair using a **Sync Code** (`SEC-XXXX-YYYY`) which links devices to the same encrypted cloud vault.

---

## 2. How to Enable / Whitelist a User Manually (10 Seconds)

When a customer buys access or contacts you:

### Method A: By User ID / Email in Firebase Console
1. Open the [Firebase Realtime Database Console](https://console.firebase.google.com/project/secretary-98cdd/database).
2. Go to the **Data** tab.
3. Click the `+` on the root node and add:
   ```json
   "subscribers": {
     "<USER_UID>": {
       "status": "active",
       "plan": "pro",
       "grantedAt": "2026-10-07"
     }
   }
   ```

### Method B: Generate a License / Activation Key
You can generate a license key (e.g. `SEC-PRO-2026-001`) and add it under `"licenses"`:
```json
"licenses": {
  "SEC-PRO-2026-001": {
    "status": "active",
    "plan": "annual"
  }
}
```

---

## 3. How to Turn on Paid / Gated Mode in Firebase

When you decide it is time to enforce subscriptions:

1. Open [Firebase Database Rules Console](https://console.firebase.google.com/project/secretary-98cdd/database/rules).
2. Replace the `users` rule block with the gated rules from [`database.rules.json`](file:///Users/etiennebeltzung/Projects/Project%203/database.rules.json):
   ```json
   {
     "rules": {
       "pairing_codes": {
         "$code": {
           ".read": "auth != null",
           ".write": "auth != null"
         }
       },
       "subscribers": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           ".write": false
         }
       },
       "users": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid && root.child('subscribers').child($uid).child('status').val() === 'active'",
           ".write": "auth != null && auth.uid === $uid && root.child('subscribers').child($uid).child('status').val() === 'active'"
         }
       }
     }
   }
   ```
3. Click **Publish**. From that moment on, only users listed in `subscribers` with `status: "active"` can sync to your managed Firebase cloud!

---

## 4. How to Automate Payments with Stripe (When Ready)

When you want 100% hands-free monetization:

1. Create a **Stripe Payment Link** or checkout (e.g. $3/month or $29/year).
2. Connect a Stripe Webhook (via a free Firebase Cloud Function or Stripe extension).
3. On `checkout.session.completed`, the webhook writes the customer's `uid` or email to the `subscribers` table in Firebase.
