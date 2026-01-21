import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  
  // Order items
  items: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true
    }
  }],
  
  // Shipping details
  shippingAddress: {
    fullName: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String, required: true },
    country: { type: String, required: true },
    phone: { type: String, required: true }
  },
  
  // Contact
  contactEmail: {
    type: String,
    required: true
  },
  
  // Payment info
  paymentMethod: {
    type: String,
    enum: ['stripe', 'paypal'],
    required: true
  },
  
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  
  // Payment IDs
  stripePaymentIntentId: String,
  stripeSessionId: String,
  paypalOrderId: String,
  paypalCaptureId: String,
  
  // Order status
  orderStatus: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  
  // Pricing
  subtotal: { type: Number, required: true },
  shipping: { type: Number, required: true },
  tax: { type: Number, required: true },
  total: { type: Number, required: true },
  
  // Additional info
  orderNotes: String,

   // Payment method
  paymentMethod: {
    type: String,
    enum: ['stripe', 'paypal', 'cod'],
    default: 'stripe'
  },
  
  // Payment IDs for tracking
  stripePaymentIntentId: String,
  stripeSessionId: String,
  paypalOrderId: String,
  paypalCaptureId: String,
  
  // Payment timestamps
  paidAt: Date,
  
  // Timestamps
  paidAt: Date,
  shippedAt: Date,
  deliveredAt: Date
}, {
  timestamps: true
});

const Order = mongoose.model('Order', orderSchema);
export default Order;