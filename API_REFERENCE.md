# AJK Shop API Documentation

Base URL: `http://localhost:3000`

## 🔑 Authentication

All protected routes require a JSON Web Token (JWT) sent in the `Authorization` header.

- **Header**: `Authorization: Bearer <your_jwt_token>`

### 1. Signup

- **Endpoint**: `POST /auth/signup`
- **Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe",
    "role": "BUYER", // or "SELLER"
    "shopName": "Optional Shop",
    "phone": "03001234567",
    "region": "Punjab"
  }
  ```
- **Response**: `{ "success": true, "data": { "token": "...", "user": { ... } } }`

### 2. Login

- **Endpoint**: `POST /auth/login`
- **Body**: `{ "email": "...", "password": "..." }`
- **Response**: `{ "success": true, "token": "...", "user": { ... } }`

---

## 📦 Products

### 1. Get Products (Search & Pagination)

- **Endpoint**: `GET /products`
- **Query Params**:
  - `q`: Search keyword (optional)
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 10)
- **Pricing Logic**:
  - `GUEST` or `BUYER`: Sees regular `price`.
  - `SELLER` or `BUSINESS_PARTNER`: Sees `partnerPrice`.
- **Response**:
  ```json
  {
    "success": true,
    "data": [{ "id": "...", "name": "...", "price": 100, ... }],
    "pagination": { "total": 50, "page": 1, "limit": 10, "totalPages": 5 }
  }
  ```

---

## 🛒 Orders

### 1. Create Order

- **Endpoint**: `POST /orders` (Protected)
- **Constraint**: Resellers must order in **multiples of 10** per item.
- **Body**:
  ```json
  {
    "items": [{ "productId": "uuid", "quantity": 10 }]
  }
  ```
- **Response**: `{ "success": true, "message": "Order created successfully", "data": { ... } }`

### 2. Reseller Stats

- **Endpoint**: `GET /orders/stats` (Reseller Only)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "totalOrders": 5,
      "lifetimeMargin": 2500.5
    }
  }
  ```

---

## 👤 User Profile

### 1. Get Profile

- **Endpoint**: `GET /user/profile` (Protected)
- **Response**: Includes cumulative `points` and `totalMargin`.

### 2. Upload Avatar

- **Endpoint**: `POST /user/avatar` (Protected)
- **Body**: `multipart/form-data` with `avatar` file.
- **Response**: `{ "success": true, "message": "Avatar uploaded successfully", "avatarUrl": "..." }`

---

## 🔴 Errors

All error responses follow this format:

```json
{
  "success": false,
  "message": "Human readable error message",
  "details": "Technical breakdown (optional)"
}
```
