import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import cors from 'cors';
import Mailjet from 'node-mailjet';
import dotenv from 'dotenv';
import User from './models/User.js';
import Product from './models/Product.js';
import Order from './models/Order.js';
import Cart from './models/Cart.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ensureGuestSession from './middleware/ensureGuestSession.js';
import cookieParser from 'cookie-parser';
import Stripe from 'stripe';
import pkg from '@paypal/checkout-server-sdk';
const { core: PayPalCore, orders: PayPalOrders } = pkg;

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config(); //

const app = express();
const PORT = process.env.PORT || 4000;

// Ensure uploads directory exists
const uploadsDir = 'uploads/products';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});


// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|avif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp avif)'));
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://yosip.netlify.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI;

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    seedAdminUser();
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

  // Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize PayPal
function paypalEnvironment() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (process.env.PAYPAL_MODE === 'live') {
    return new PayPalCore.LiveEnvironment(clientId, clientSecret);
  } else {
    return new PayPalCore.SandboxEnvironment(clientId, clientSecret);
  }
}

function paypalClient() {
  return new PayPalCore.PayPalHttpClient(paypalEnvironment());
}

console.log('💳 Payment processors initialized');
if (process.env.STRIPE_SECRET_KEY) console.log('   ✅ Stripe configured');
if (process.env.PAYPAL_CLIENT_ID) console.log('   ✅ PayPal configured');


// Helper function to get country code for PayPal
function getCountryCode(countryName) {
  const countryCodes = {
    'Nigeria': 'NG',
    'United States': 'US',
    'United Kingdom': 'GB',
    'Canada': 'CA',
    'Australia': 'AU',
    'Germany': 'DE',
    'France': 'FR',
    'Italy': 'IT',
    'Spain': 'ES',
    'Netherlands': 'NL',
    'Belgium': 'BE',
    'Switzerland': 'CH',
    'Sweden': 'SE',
    'Norway': 'NO',
    'Denmark': 'DK',
    'Finland': 'FI',
    'Poland': 'PL',
    'Ireland': 'IE',
    'Portugal': 'PT',
    'Austria': 'AT',
    'Greece': 'GR',
    'South Africa': 'ZA',
    'Kenya': 'KE',
    'Ghana': 'GH',
    'Egypt': 'EG',
    'Morocco': 'MA',
    'Brazil': 'BR',
    'Mexico': 'MX',
    'Argentina': 'AR',
    'Chile': 'CL',
    'Japan': 'JP',
    'South Korea': 'KR',
    'China': 'CN',
    'India': 'IN',
    'Singapore': 'SG',
    'Malaysia': 'MY',
    'Thailand': 'TH',
    'Indonesia': 'ID',
    'Philippines': 'PH',
    'Vietnam': 'VN',
    'New Zealand': 'NZ',
    'United Arab Emirates': 'AE',
    'Saudi Arabia': 'SA',
    'Israel': 'IL',
    'Turkey': 'TR'
  };
  return countryCodes[countryName] || 'US';
}

// ================= MAILJET CONFIGURATION =================
const mailjetClient = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY) {
  console.log('✅ Mailjet API configured successfully');
  console.log('📧 Sending from:', process.env.MAILJET_FROM_EMAIL);
} else {
  console.warn('⚠️ Mailjet not configured - emails will fail');
}

// ================= SEED ADMIN USER =================
async function seedAdminUser() {
  try {
    const adminEmail = 'admin@yosip.com';
    const adminPassword = 'admin@yosip';
    
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      console.log('Admin user already exists');
      return;
    }
    
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const adminUser = new User({
      name: 'Admin',
      email: adminEmail,
      password: hashedPassword,
      role: 'admin'
    });
    
    await adminUser.save();
    console.log('Admin user created successfully');
    console.log(`Email: ${adminEmail}`);
    console.log(`Password: ${adminPassword}`);
  } catch (error) {
    console.error('Error seeding admin user:', error);
  }
}

// ================= EMAIL TEMPLATES =================
const createOrderConfirmationEmail = (order) => {
  const itemsHtml = order.items.map(item => `
    <tr>
      <td style="padding: 15px; border-bottom: 2px solid #e5e7eb;">
        <strong style="color: #1f2937; font-size: 16px;">${item.productName}</strong>
        <div style="color: #6b7280; font-size: 14px; margin-top: 5px;">Qty: ${item.quantity}</div>
      </td>
      <td style="padding: 15px; border-bottom: 2px solid #e5e7eb; text-align: right;">
        <strong style="color: #1f2937; font-size: 16px;">$${item.subtotal.toFixed(2)}</strong>
      </td>
    </tr>
  `).join('');

  return {
    subject: `Order Confirmation #${order.orderNumber} - Yosip`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f3f4f6;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      padding: 40px 30px;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 32px;
      font-weight: 700;
    }
    .header p {
      margin: 10px 0 0 0;
      font-size: 16px;
      opacity: 0.9;
    }
    .content {
      padding: 40px 30px;
    }
    .order-number {
      background-color: #dbeafe;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      margin-bottom: 30px;
    }
    .order-number span {
      font-size: 24px;
      font-weight: 700;
      color: #1e40af;
    }
    .status-badge {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      margin-top: 10px;
    }
    .status-pending {
      background-color: #fef3c7;
      color: #92400e;
    }
    .status-paid {
      background-color: #d1fae5;
      color: #065f46;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #1f2937;
      margin: 30px 0 15px 0;
      padding-bottom: 10px;
      border-bottom: 2px solid #e5e7eb;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    .total-section {
      background-color: #f9fafb;
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      margin: 10px 0;
      font-size: 16px;
    }
    .total-final {
      font-size: 20px;
      font-weight: 700;
      color: #1f2937;
      padding-top: 15px;
      border-top: 2px solid #e5e7eb;
      margin-top: 10px;
    }
    .shipping-address {
      background-color: #f0fdf4;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #10b981;
    }
    .shipping-address p {
      margin: 5px 0;
      color: #1f2937;
      line-height: 1.6;
    }
    .footer {
      background-color: #1f2937;
      padding: 30px;
      text-align: center;
      color: #d1d5db;
    }
    .footer-brand {
      font-size: 24px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 10px;
    }
    .footer-text {
      font-size: 14px;
      margin: 5px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Order Confirmed!</h1>
      <p>Thank you for your purchase</p>
    </div>
    
    <div class="content">
      <div class="order-number">
        <div style="color: #6b7280; font-size: 14px; margin-bottom: 5px;">Order Number</div>
        <span>#${order.orderNumber}</span>
        <div>
          <span class="status-badge status-${order.paymentStatus}">
            ${order.paymentStatus === 'paid' ? '✓ PAID' : '⏳ PAYMENT PENDING'}
          </span>
        </div>
      </div>

      <p style="font-size: 16px; color: #4b5563; line-height: 1.6;">
        Hi <strong>${order.customerInfo.name}</strong>,<br><br>
        We've received your order and we're getting it ready! You'll receive a shipping confirmation 
        email with tracking information once your items are on their way.
      </p>

      <div class="section-title">📦 Order Items</div>
      <table>
        ${itemsHtml}
      </table>

      <div class="total-section">
        <div class="total-row">
          <span>Subtotal</span>
          <span>$${(order.totalAmount - order.shippingFee - order.tax).toFixed(2)}</span>
        </div>
        <div class="total-row">
          <span>Shipping</span>
          <span>$${order.shippingFee.toFixed(2)}</span>
        </div>
        <div class="total-row">
          <span>Tax</span>
          <span>$${order.tax.toFixed(2)}</span>
        </div>
        <div class="total-row total-final">
          <span>Total</span>
          <span>$${order.totalAmount.toFixed(2)}</span>
        </div>
      </div>

      <div class="section-title">🚚 Shipping Address</div>
      <div class="shipping-address">
        <p><strong>${order.customerInfo.name}</strong></p>
        <p>${order.shippingAddress.street}</p>
        <p>${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.zipCode}</p>
        <p>${order.shippingAddress.country}</p>
      </div>

      <div style="text-align: center; margin-top: 30px;">
        <p style="color: #6b7280;">Need help with your order?</p>
        <p style="color: #6b7280;">Contact us at support@yosip.com or call +1 (306) 216-7657</p>
      </div>
    </div>
    
    <div class="footer">
      <div class="footer-brand">YOSIP</div>
      <p class="footer-text">Quality Products, Delivered to You</p>
      <p class="footer-text">📧 support@yosip.com | 📞 +1 (306) 216-7657</p>
      <p class="footer-text" style="margin-top: 20px; font-size: 12px; opacity: 0.8;">
        © ${new Date().getFullYear()} Yosip. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
`
  };
};

const createAdminOrderNotificationEmail = (order) => {
  const itemsHtml = order.items.map(item => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.productName}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${item.price.toFixed(2)}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;"><strong>$${item.subtotal.toFixed(2)}</strong></td>
    </tr>
  `).join('');

  return {
    subject: `New Order #${order.orderNumber} - $${order.totalAmount.toFixed(2)}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
    h1 { color: #2563eb; margin-bottom: 5px; }
    .order-info { background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
    .info-label { font-size: 12px; color: #6b7280; text-transform: uppercase; font-weight: 600; }
    .info-value { font-size: 16px; color: #1f2937; font-weight: 600; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #2563eb; color: white; padding: 12px; text-align: left; }
    td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
    .total-section { background: #f9fafb; padding: 20px; border-radius: 8px; margin-top: 20px; }
    .total-row { display: flex; justify-content: space-between; margin: 8px 0; }
    .total-final { font-size: 20px; font-weight: 700; padding-top: 10px; border-top: 2px solid #e5e7eb; margin-top: 10px; }
    .status-badge { 
      display: inline-block; 
      padding: 6px 12px; 
      border-radius: 12px; 
      font-size: 12px; 
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-paid { background: #d1fae5; color: #065f46; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔔 New Order Received</h1>
    <p style="color: #6b7280; margin-top: 0;">Order #${order.orderNumber} placed on ${new Date(order.createdAt).toLocaleString()}</p>
    
    <div class="order-info">
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Customer</div>
          <div class="info-value">${order.customerInfo.name}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Email</div>
          <div class="info-value">${order.customerInfo.email}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Phone</div>
          <div class="info-value">${order.customerInfo.phone}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Payment Status</div>
          <div class="info-value">
            <span class="status-badge badge-${order.paymentStatus}">
              ${order.paymentStatus === 'paid' ? '✓ PAID' : '⏳ PENDING'}
            </span>
          </div>
        </div>
      </div>
    </div>

    <h2 style="color: #1f2937; margin-top: 30px;">Order Items</h2>
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align: center;">Quantity</th>
          <th style="text-align: right;">Price</th>
          <th style="text-align: right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="total-section">
      <div class="total-row">
        <span>Subtotal</span>
        <span>$${(order.totalAmount - order.shippingFee - order.tax).toFixed(2)}</span>
      </div>
      <div class="total-row">
        <span>Shipping</span>
        <span>$${order.shippingFee.toFixed(2)}</span>
      </div>
      <div class="total-row">
        <span>Tax</span>
        <span>$${order.tax.toFixed(2)}</span>
      </div>
      <div class="total-row total-final">
        <span>Total</span>
        <span>$${order.totalAmount.toFixed(2)}</span>
      </div>
    </div>

    <h2 style="color: #1f2937; margin-top: 30px;">Shipping Address</h2>
    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981;">
      <p style="margin: 5px 0; color: #1f2937;"><strong>${order.customerInfo.name}</strong></p>
      <p style="margin: 5px 0; color: #1f2937;">${order.shippingAddress.street}</p>
      <p style="margin: 5px 0; color: #1f2937;">${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.zipCode}</p>
      <p style="margin: 5px 0; color: #1f2937;">${order.shippingAddress.country}</p>
    </div>

    ${order.notes ? `
    <h2 style="color: #1f2937; margin-top: 30px;">Order Notes</h2>
    <div style="background: #fef3c7; padding: 15px; border-radius: 8px;">
      <p style="margin: 0; color: #78350f;">${order.notes}</p>
    </div>
    ` : ''}
  </div>
</body>
</html>
`
  };
};

// ================= EMAIL SENDING FUNCTIONS =================
const sendOrderConfirmationEmail = async (order) => {
  console.log('\n🔵 sendOrderConfirmationEmail called');
  console.log('   Order:', order.orderNumber);
  console.log('   Email:', order.customerInfo.email);

  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    console.error('   ❌ Mailjet not configured');
    return { sent: false, reason: 'Mailjet not configured' };
  }

  try {
    const emailContent = createOrderConfirmationEmail(order);
    
    const request = mailjetClient
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [{
          From: {
            Email: process.env.MAILJET_FROM_EMAIL,
            Name: process.env.MAILJET_FROM_NAME || 'Yosip'
          },
          To: [{
            Email: order.customerInfo.email,
            Name: order.customerInfo.name
          }],
          Subject: emailContent.subject,
          HTMLPart: emailContent.html
        }]
      });

    const response = await request;
    
    if (response.body?.Messages?.[0]?.Status === 'success') {
      console.log('   ✅ Order confirmation sent');
      return { sent: true, messageId: response.body.Messages[0].To[0].MessageID };
    } else {
      console.warn('   ⚠️ Unexpected response');
      return { sent: false, reason: 'Unexpected response' };
    }
  } catch (error) {
    console.error('   ❌ Email failed:', error.message);
    return { sent: false, error: error.message };
  }
};

const sendAdminOrderNotification = async (order) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'godson.ihemere@gmail.com';
  
  console.log('\n🔵 sendAdminOrderNotification called');
  console.log('   Admin email:', adminEmail);

  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    return { sent: false, reason: 'Mailjet not configured' };
  }

  try {
    const emailContent = createAdminOrderNotificationEmail(order);
    
    const request = mailjetClient
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [{
          From: {
            Email: process.env.MAILJET_FROM_EMAIL,
            Name: 'Yosip System'
          },
          To: [{
            Email: adminEmail,
            Name: 'Admin'
          }],
          Subject: emailContent.subject,
          HTMLPart: emailContent.html
        }]
      });

    const response = await request;
    
    if (response.body?.Messages?.[0]?.Status === 'success') {
      console.log('   ✅ Admin notification sent');
      return { sent: true };
    }
    return { sent: false };
  } catch (error) {
    console.error('   ❌ Admin email failed:', error.message);
    return { sent: false, error: error.message };
  }
};

// ================= HELPER FUNCTIONS =================
const generateOrderNumber = () => {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `YOS${timestamp}${random}`;
};

// ================= AUTH ENDPOINTS =================
app.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'Name, email and password are required' 
    });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone,
      role: 'customer'
    });
    
    await user.save();
    
    res.json({
      success: true,
      message: 'Registration successful',
      user: { 
        id: user._id, 
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  try {
    const user = await User.findOne({ email });
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const userObject = user.toObject();
    delete userObject.password;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        user: { ...userObject, id: user._id }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

// ================= PRODUCTS ENDPOINTS =================
app.get('/products', async (req, res) => {
  try {
    const { category, search, isActive } = req.query;
    
    const filter = {};
    
    // Only filter by isActive if explicitly provided
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }
    // If isActive is not provided, don't add it to filter (returns all products)
    
    if (category) filter.category = category;
    if (search) filter.name = { $regex: search, $options: 'i' };
    
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

app.post('/products', upload.array('images', 5), async (req, res) => {
  try {
    console.log('📁 Request body:', req.body);
    console.log('📸 Files received:', req.files);
    console.log('📸 Files length:', req.files?.length);
    
    const productData = req.body;
    
    // Generate SKU if not provided
    if (!productData.sku) {
      productData.sku = `SKU${Date.now()}`;
    }
    
    // Add uploaded image paths
    if (req.files && req.files.length > 0) {
      console.log('✅ Processing', req.files.length, 'images');
      productData.images = req.files.map(file => {
        console.log('   - File:', file.filename);
        return `/uploads/products/${file.filename}`;
      });
      console.log('📸 Image paths:', productData.images);
    } else {
      console.log('⚠️ No files received');
    }
    
    console.log('💾 Creating product with data:', productData);
    
    const product = new Product(productData);
    await product.save();
    
    console.log('✅ Product created:', product._id);
    
    res.json({
      success: true,
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Clean up uploaded files if product creation fails
    if (req.files) {
      console.log('🗑️ Cleaning up', req.files.length, 'uploaded files');
      req.files.forEach(file => {
        fs.unlink(file.path, err => {
          if (err) console.error('Error deleting file:', err);
        });
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Product with this SKU already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error occurred',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.put('/products/:id', upload.array('images', 5), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const productData = req.body;
    
    // Handle image updates
    if (req.files && req.files.length > 0) {
      // Delete old images before uploading new ones
      if (product.images && product.images.length > 0) {
        product.images.forEach(imagePath => {
          const fullPath = path.join(__dirname, imagePath);
          fs.unlink(fullPath, err => {
            if (err) console.error('Error deleting old image:', err);
          });
        });
      }
      
      // Add new uploaded image paths
      productData.images = req.files.map(file => `/uploads/products/${file.filename}`);
    }
    
    // Update product fields
    Object.keys(productData).forEach(key => {
      product[key] = productData[key];
    });
    
    await product.save();
    
    res.json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    // Clean up uploaded files if update fails
    if (req.files) {
      req.files.forEach(file => {
        fs.unlink(file.path, err => {
          if (err) console.error('Error deleting file:', err);
        });
      });
    }
    
    console.error('Error updating product:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Product with this SKU already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error occurred' 
    });
  }
});

// PATCH endpoint to update product active status only
app.patch('/products/:id/status', async (req, res) => {
  try {
    const { isActive } = req.body;
    
    // Validate the isActive field
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        message: 'isActive must be a boolean value' 
      });
    }

    // Find and update the product
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true, runValidators: true }
    );
    
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }
    
    res.json({
      success: true,
      message: `Product ${isActive ? 'activated' : 'deactivated'} successfully`,
      product: {
        _id: product._id,
        name: product.name,
        isActive: product.isActive
      }
    });
  } catch (error) {
    console.error('Error updating product status:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error occurred' 
    });
  }
});

// Alternative: More flexible PATCH endpoint that can update any single field
app.patch('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    // Only allow specific fields to be updated via PATCH
    const allowedUpdates = ['isActive', 'stock', 'price'];
    const updates = Object.keys(req.body);
    
    // Check if all updates are allowed
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));
    
    if (!isValidOperation) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid updates. Only isActive, stock, and price can be updated via PATCH' 
      });
    }
    
    // Apply updates
    updates.forEach(update => {
      product[update] = req.body[update];
    });
    
    await product.save();
    
    res.json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error occurred' 
    });
  }
});

app.delete('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }
    
    // Delete associated images
    if (product.images && product.images.length > 0) {
      product.images.forEach(imagePath => {
        const fullPath = path.join(process.cwd(), imagePath);
        fs.unlink(fullPath, err => {
          if (err) console.error('Error deleting image:', err);
        });
      });
    }
    
    await Product.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred' 
    });
  }
});

// ================= ORDERS ENDPOINTS =================

app.get('/orders', async (req, res) => {
  try {
    const { status, customerId } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (customerId) filter.customerId = customerId;
    
    const orders = await Order.find(filter)
      .populate('customerId', 'name email')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, orders });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

app.get('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customerId', 'name email phone')
      .populate('items.productId', 'name images');
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

app.post('/orders', async (req, res) => {
  console.log('\n📦 ========== NEW ORDER REQUEST ==========');
  
  try {
    const { customerId, customerInfo, items, shippingAddress, shippingFee, tax, paymentMethod, notes } = req.body;

    if (!customerInfo || !items || !items.length || !shippingAddress) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productId}`
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}`
        });
      }

      const itemSubtotal = product.price * item.quantity;
      subtotal += itemSubtotal;

      orderItems.push({
        productId: product._id,
        productName: product.name,
        quantity: item.quantity,
        price: product.price,
        subtotal: itemSubtotal
      });

      product.stock -= item.quantity;
      await product.save();
    }

    const totalAmount = subtotal + (shippingFee || 0) + (tax || 0);

    const order = new Order({
      orderNumber: generateOrderNumber(),
      customerId: customerId || null,
      customerInfo,
      items: orderItems,
      shippingAddress,
      totalAmount,
      shippingFee: shippingFee || 0,
      tax: tax || 0,
      paymentMethod,
      notes,
      status: 'pending',
      paymentStatus: 'unpaid'
    });

    await order.save();
    
    console.log('   ✅ Order created:', order.orderNumber);
    console.log('   💰 Total:', `${totalAmount.toFixed(2)}`);

    console.log('\n📧 Sending emails...');
    const customerEmailResult = await sendOrderConfirmationEmail(order);
    const adminEmailResult = await sendAdminOrderNotification(order);
    
    console.log('   Customer email:', customerEmailResult.sent ? '✅' : '❌');
    console.log('   Admin email:', adminEmailResult.sent ? '✅' : '❌');
    console.log('========================================\n');

    res.json({
      success: true,
      message: 'Order placed successfully',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        status: order.status,
        paymentStatus: order.paymentStatus
      },
      emailStatus: {
        customer: customerEmailResult.sent,
        admin: adminEmailResult.sent
      }
    });
  } catch (error) {
    console.error('❌ Order creation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred',
      error: error.message 
    });
  }
});

app.put('/orders/:id', async (req, res) => {
  try {
    const { status, paymentStatus, trackingNumber } = req.body;
    
    const updateData = {};
    if (status) updateData.status = status;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (trackingNumber) updateData.trackingNumber = trackingNumber;
    
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    res.json({
      success: true,
      message: 'Order updated successfully',
      order
    });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

// ================= CART ENDPOINTS =================

// Create a lock manager (add this at the top of your routes file)
const cartLocks = new Map();

const acquireLock = async (key, maxWait = 5000) => {
  const startTime = Date.now();
  
  while (cartLocks.has(key)) {
    if (Date.now() - startTime > maxWait) {
      throw new Error('Lock timeout');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  cartLocks.set(key, true);
};

const releaseLock = (key) => {
  cartLocks.delete(key);
};


// GET CART
app.get('/cart', ensureGuestSession, async (req, res) => {
  try {
    const userId = req.query.userId || null;
    const sessionId = userId ? null : req.sessionId;

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'userId or sessionId required'
      });
    }

    const filter = userId ? { userId } : { sessionId };
    const cart = await Cart.findOne(filter).populate('items.productId');

    // If no cart exists, return empty cart (don't create one)
    if (!cart) {
      return res.json({
        success: true,
        cart: {
          items: [],
          itemCount: 0
        }
      });
    }

    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    res.json({
      success: true,
      cart: {
        id: cart._id,
        items: cart.items,
        itemCount
      }
    });
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred',
      error: error.message 
    });
  }
});

// ADD TO CART

app.post('/cart/add', ensureGuestSession, async (req, res) => {
  const lockKey = req.body.userId || req.sessionId;
  
  try {
    // Acquire lock for this user/session
    await acquireLock(lockKey);
    
    const {productId, quantity = 1 } = req.body;

    const userId = req.body.userId || null; 
    const sessionId = userId ? null : req.sessionId;

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'userId or sessionId required'
      });
    }

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'productId is required'
      });
    }

    // Validate IDs
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    // Verify product exists
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (!product.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Product is not available'
      });
    }

    if (quantity > product.stock) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} items available in stock`
      });
    }

    const filter = userId ? { userId } : { sessionId };
    
    // Find existing cart
    let cart = await Cart.findOne(filter);

    if (!cart) {
      // Create new cart
      cart = new Cart({
        ...filter,
        items: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Check if product exists in cart
    const existingItemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId.toString()
    );

    if (existingItemIndex > -1) {
      // Product exists - update quantity
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;
      
      if (newQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} items available in stock`
        });
      }

      cart.items[existingItemIndex].quantity = newQuantity;
      cart.items[existingItemIndex].addedAt = new Date();
    } else {
      // New product - add to cart
      cart.items.push({
        productId: productId,
        quantity: quantity,
        addedAt: new Date()
      });
    }

    cart.updatedAt = new Date();
    await cart.save();
    await cart.populate('items.productId');

    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    res.json({
      success: true,
      message: existingItemIndex > -1 ? 'Cart quantity updated' : 'Item added to cart',
      cart: {
        id: cart._id,
        items: cart.items,
        itemCount
      }
    });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred',
      error: error.message 
    });
  } finally {
    // Always release the lock
    releaseLock(lockKey);
  }
});

// UPDATE CART ITEM
app.put('/cart/update', ensureGuestSession, async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    const userId = req.body.userId || null; 
    const sessionId = userId ? null : req.sessionId;

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'userId or sessionId required'
      });
    }

    if (!productId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'productId and quantity are required'
      });
    }

    // Validate IDs
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    // Allow 0 for removal, but not negative numbers
    if (quantity < 0 || !Number.isInteger(quantity)) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be a non-negative integer'
      });
    }

    const filter = userId ? { userId } : { sessionId };
    const cart = await Cart.findOne(filter);

    if (!cart) {
      return res.status(404).json({ 
        success: false, 
        message: 'Cart not found' 
      });
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId.toString()
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    // If quantity is 0, remove the item
    if (quantity === 0) {
      cart.items.splice(itemIndex, 1);
      await cart.save();
      await cart.populate('items.productId');

      const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

      return res.json({
        success: true,
        message: 'Item removed from cart',
        cart: {
          id: cart._id,
          items: cart.items,
          itemCount
        }
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (quantity > product.stock) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} items available in stock`
      });
    }

    cart.items[itemIndex].quantity = quantity;
    await cart.save();
    await cart.populate('items.productId');

    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    res.json({
      success: true,
      message: 'Cart updated',
      cart: {
        id: cart._id,
        items: cart.items,
        itemCount
      }
    });
  } catch (error) {
    console.error('Error updating cart:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred',
      error: error.message 
    });
  }
});

// REMOVE FROM CART
app.delete('/cart/remove', async (req, res) => {
  try {
    const { productId } = req.body;
    
    // Get userId from session or use sessionId from cookies
    const userId = req.session?.userId || req.user?._id;
    const sessionId = req.sessionID;

    console.log('Remove from cart - userId:', userId, 'sessionId:', sessionId);

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'No active session found'
      });
    }

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'productId is required'
      });
    }

    // Validate IDs
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    const filter = userId ? { userId } : { sessionId };
    const cart = await Cart.findOne(filter);

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items = cart.items.filter(
      item => item.productId.toString() !== productId
    );

    await cart.save();
    await cart.populate('items.productId');

    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    res.json({
      success: true,
      message: 'Item removed from cart',
      cart: {
        id: cart._id,
        items: cart.items,
        itemCount
      }
    });
  } catch (error) {
    console.error('Error removing from cart:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred',
      error: error.message 
    });
  }
});

// CLEAR CART
app.delete('/cart/clear', async (req, res) => {
  try {
    const { userId, sessionId } = req.body;

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'userId or sessionId required'
      });
    }

    // Validate userId if provided
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    const filter = userId ? { userId } : { sessionId };
    const cart = await Cart.findOne(filter);

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items = [];
    await cart.save();

    res.json({
      success: true,
      message: 'Cart cleared',
      cart: {
        id: cart._id,
        items: [],
        itemCount: 0
      }
    });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred',
      error: error.message 
    });
  }
});

// MERGE CARTS (after login)
app.post('/cart/merge', async (req, res) => {
  try {
    const { userId, sessionId } = req.body;

    if (!userId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Both userId and sessionId are required'
      });
    }

    // Validate userId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    const guestCart = await Cart.findOne({ sessionId });
    let userCart = await Cart.findOne({ userId });

    if (!guestCart || guestCart.items.length === 0) {
      if (!userCart) {
        userCart = new Cart({ userId });
        await userCart.save();
      }
      
      await userCart.populate('items.productId');
      
      return res.json({
        success: true,
        message: 'No items to merge',
        cart: {
          id: userCart._id,
          items: userCart.items,
          itemCount: userCart.items.reduce((sum, item) => sum + item.quantity, 0)
        }
      });
    }

    if (!userCart) {
      guestCart.userId = userId;
      guestCart.sessionId = undefined;
      await guestCart.save();
      await guestCart.populate('items.productId');
      
      return res.json({
        success: true,
        message: 'Cart merged successfully',
        cart: {
          id: guestCart._id,
          items: guestCart.items,
          itemCount: guestCart.items.reduce((sum, item) => sum + item.quantity, 0)
        }
      });
    }

    for (const guestItem of guestCart.items) {
      const existingItemIndex = userCart.items.findIndex(
        item => item.productId.toString() === guestItem.productId.toString()
      );

      if (existingItemIndex > -1) {
        userCart.items[existingItemIndex].quantity += guestItem.quantity;
      } else {
        userCart.items.push(guestItem);
      }
    }

    await userCart.save();
    await Cart.deleteOne({ sessionId });
    await userCart.populate('items.productId');

    res.json({
      success: true,
      message: 'Cart merged successfully',
      cart: {
        id: userCart._id,
        items: userCart.items,
        itemCount: userCart.items.reduce((sum, item) => sum + item.quantity, 0)
      }
    });
  } catch (error) {
    console.error('Error merging cart:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred',
      error: error.message 
    });
  }
});

// ================= USERS ENDPOINTS =================
app.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 });
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id, { password: 0 });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

// ================= TEST ENDPOINTS =================
app.get('/test-email', async (req, res) => {
  const testEmail = req.query.email || process.env.ADMIN_EMAIL || 'godson.ihemere@gmail.com';
  
  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: 'Mailjet not configured'
    });
  }
  
  try {
    const request = mailjetClient
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [{
          From: {
            Email: process.env.MAILJET_FROM_EMAIL,
            Name: 'Yosip Test'
          },
          To: [{
            Email: testEmail,
            Name: 'Test User'
          }],
          Subject: '✅ Yosip Email Test',
          HTMLPart: '<h1>Test Successful</h1><p>Mailjet is configured correctly for Yosip!</p>'
        }]
      });

    const response = await request;
    
    res.json({
      success: true,
      message: 'Test email sent!',
      to: testEmail,
      messageId: response.body.Messages[0].To[0].MessageID
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================= STATS ENDPOINT =================
app.get('/stats', async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    const totalProducts = await Product.countDocuments();
    const totalCustomers = await User.countDocuments({ role: 'customer' });
    
    const revenueResult = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const totalRevenue = revenueResult[0]?.total || 0;
    
    res.json({
      success: true,
      stats: {
        totalOrders,
        pendingOrders,
        totalProducts,
        totalCustomers,
        totalRevenue
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

// CREATE PAYMENT SESSION (Stripe or PayPal)
app.post('/orders/create-payment', async (req, res) => {
  console.log('\n💳 ========== PAYMENT SESSION CREATION ==========');
  
  try {
    const {
      items,
      shippingAddress,
      contactEmail,
      paymentMethod,
      orderNotes,
      subtotal,
      shipping,
      tax,
      total
    } = req.body;

    // Validate required fields
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    if (!shippingAddress || !contactEmail || !paymentMethod) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    console.log('   Payment Method:', paymentMethod);
    console.log('   Total Amount:', total);

    // Prepare order items with product details
    const orderItems = [];
    let calculatedSubtotal = 0;

    for (const item of items) {
      const product = await Product.findById(item.productId);
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productId}`
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}`
        });
      }

      const itemSubtotal = product.price * item.quantity;
      calculatedSubtotal += itemSubtotal;

      orderItems.push({
        productId: product._id,
        productName: product.name,
        quantity: item.quantity,
        price: product.price,
        subtotal: itemSubtotal
      });
    }

    // Create order in database (pending payment)
    const order = new Order({
      orderNumber: generateOrderNumber(),
      customerId: req.user?._id || null,
      customerInfo: {
        name: shippingAddress.fullName,
        email: contactEmail,
        phone: shippingAddress.phone
      },
      items: orderItems,
      shippingAddress: {
        street: shippingAddress.address,
        city: shippingAddress.city,
        state: shippingAddress.state,
        zipCode: shippingAddress.zipCode,
        country: shippingAddress.country
      },
      totalAmount: total,
      shippingFee: shipping || 0,
      tax: tax || 0,
      paymentMethod,
      notes: orderNotes,
      status: 'pending',
      paymentStatus: 'unpaid'
    });

    await order.save();
    console.log('   ✅ Order created:', order.orderNumber);

    // Create payment based on method
    if (paymentMethod === 'stripe') {
      console.log('   🔵 Creating Stripe session...');
      
      // Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          // Order items
          ...orderItems.map(item => ({
            price_data: {
              currency: 'usd',
              product_data: {
                name: item.productName,
              },
              unit_amount: Math.round(item.price * 100), // Convert to cents
            },
            quantity: item.quantity,
          })),
          // Shipping
          ...(shipping > 0 ? [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Shipping',
              },
              unit_amount: Math.round(shipping * 100),
            },
            quantity: 1,
          }] : []),
          // Tax
          ...(tax > 0 ? [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Tax',
              },
              unit_amount: Math.round(tax * 100),
            },
            quantity: 1,
          }] : [])
        ],
        mode: 'payment',
        success_url: `${process.env.FRONTEND_URL}/order-success?session_id={CHECKOUT_SESSION_ID}&order_id=${order._id}`,
        cancel_url: `${process.env.FRONTEND_URL}/checkout?cancelled=true`,
        customer_email: contactEmail,
        metadata: {
          orderId: order._id.toString()
        }
      });

      // Save Stripe session ID to order
      order.stripeSessionId = session.id;
      await order.save();

      console.log('   ✅ Stripe session created:', session.id);
      console.log('========================================\n');

      return res.status(200).json({
        success: true,
        stripeUrl: session.url,
        orderId: order._id,
        sessionId: session.id
      });

    } else if (paymentMethod === 'paypal') {
      console.log('   🔵 Creating PayPal order...');
      
      // Create PayPal order
      const request = new PayPalOrders.OrdersCreateRequest();
      request.prefer("return=representation");
      request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'USD',
            value: total.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: 'USD',
                value: calculatedSubtotal.toFixed(2)
              },
              shipping: {
                currency_code: 'USD',
                value: (shipping || 0).toFixed(2)
              },
              tax_total: {
                currency_code: 'USD',
                value: (tax || 0).toFixed(2)
              }
            }
          },
          items: orderItems.map(item => ({
            name: item.productName,
            unit_amount: {
              currency_code: 'USD',
              value: item.price.toFixed(2)
            },
            quantity: item.quantity.toString()
          })),
          shipping: {
            name: {
              full_name: shippingAddress.fullName
            },
            address: {
              address_line_1: shippingAddress.address,
              admin_area_2: shippingAddress.city,
              admin_area_1: shippingAddress.state,
              postal_code: shippingAddress.zipCode,
              country_code: getCountryCode(shippingAddress.country)
            }
          }
        }],
        application_context: {
          return_url: `${process.env.BACKEND_URL || 'http://localhost:4000'}/payment/paypal-success?orderId=${order._id}`,
          cancel_url: `${process.env.FRONTEND_URL}/checkout?cancelled=true`,
          brand_name: 'Yosip',
          user_action: 'PAY_NOW'
        }
      });

      const paypalOrder = await paypalClient().execute(request);
      
      // Save PayPal order ID
      order.paypalOrderId = paypalOrder.result.id;
      await order.save();

      // Get approval URL
      const approvalUrl = paypalOrder.result.links.find(link => link.rel === 'approve').href;

      console.log('   ✅ PayPal order created:', paypalOrder.result.id);
      console.log('========================================\n');

      return res.status(200).json({
        success: true,
        paypalUrl: approvalUrl,
        orderId: order._id,
        paypalOrderId: paypalOrder.result.id
      });
    }

  } catch (error) {
    console.error('❌ Payment creation error:', error);
    res.status(500).json({ 
      message: 'Payment initialization failed', 
      error: error.message 
    });
  }
});

// STRIPE WEBHOOK (for payment confirmation)
app.post('/payment/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('\n⚡ Stripe Webhook Event:', event.type);

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      
      console.log('   Session completed:', session.id);
      console.log('   Order ID:', session.metadata.orderId);
      
      // Update order status
      const order = await Order.findById(session.metadata.orderId);
      if (order) {
        order.paymentStatus = 'paid';
        order.status = 'processing';
        order.paidAt = new Date();
        order.stripePaymentIntentId = session.payment_intent;
        await order.save();

        // Reduce product stock
        for (const item of order.items) {
          await Product.findByIdAndUpdate(
            item.productId,
            { $inc: { stock: -item.quantity } }
          );
        }

        // Clear user's cart if logged in
        if (order.customerId) {
          await Cart.findOneAndUpdate(
            { userId: order.customerId },
            { $set: { items: [] } }
          );
        }

        // Send confirmation emails
        await sendOrderConfirmationEmail(order);
        await sendAdminOrderNotification(order);

        console.log('   ✅ Order updated to PAID');
      }
      break;

    case 'payment_intent.payment_failed':
      const failedIntent = event.data.object;
      console.log('   ❌ Payment failed:', failedIntent.id);
      break;

    default:
      console.log(`   ℹ️  Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// PAYPAL SUCCESS REDIRECT
app.get('/payment/paypal-success', async (req, res) => {
  console.log('\n✅ PayPal Success Redirect');
  
  try {
    const { orderId, token } = req.query; // token is PayPal's order ID

    console.log('   Order ID:', orderId);
    console.log('   PayPal Token:', token);

    // Capture the payment
    const request = new PayPalOrders.OrdersCaptureRequest(token);
    request.requestBody({});

    const capture = await paypalClient().execute(request);

    console.log('   Capture status:', capture.result.status);

    if (capture.result.status === 'COMPLETED') {
      // Update order
      const order = await Order.findById(orderId);
      if (order) {
        order.paymentStatus = 'paid';
        order.status = 'processing';
        order.paidAt = new Date();
        order.paypalCaptureId = capture.result.id;
        await order.save();

        // Reduce product stock
        for (const item of order.items) {
          await Product.findByIdAndUpdate(
            item.productId,
            { $inc: { stock: -item.quantity } }
          );
        }

        // Clear user's cart if logged in
        if (order.customerId) {
          await Cart.findOneAndUpdate(
            { userId: order.customerId },
            { $set: { items: [] } }
          );
        }

        // Send confirmation emails
        await sendOrderConfirmationEmail(order);
        await sendAdminOrderNotification(order);

        console.log('   ✅ Order updated to PAID');
      }

      // Redirect to success page
      res.redirect(`${process.env.FRONTEND_URL}/order-success?order_id=${orderId}`);
    } else {
      console.log('   ❌ Payment not completed');
      res.redirect(`${process.env.FRONTEND_URL}/checkout?payment_failed=true`);
    }
  } catch (error) {
    console.error('❌ PayPal capture error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/checkout?payment_error=true`);
  }
});

// GET ORDER BY ID (for success page)
app.get('/orders/by-id/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId)
      .populate('items.productId', 'name price images')
      .populate('customerId', 'name email');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.status(200).json({
      success: true,
      order
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
});


// ================= 404 HANDLER =================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    requested: req.path
  });
});

// ================= ERROR HANDLER =================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`🚀 Yosip E-commerce Server running on port ${PORT}`);
  console.log(`📍 API: http://localhost:${PORT}`);
});

export default app;