import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  stock: { type: Number, default: 0 },
  images: [String],
  isActive: { type: Boolean, default: false },
  sku: { type: String, unique: true }
}, { timestamps: true });

export default mongoose.model('Product', productSchema);