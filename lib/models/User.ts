import mongoose, { Schema, Types } from "mongoose"

export interface IUser {
  _id: Types.ObjectId
  name: string
  username: string
  phone?: string
  rank: string
  local?: { email?: string; password?: string }
  affiliates?: {
    // Partner alanları (rank: "partner" olan kullanıcılarda)
    code?: string | null          // Partner'ın affiliate kodu (register?a= ile eşleşen)
    referred: number              // Toplam referral sayısı
    deposited: number             // Referralların toplam yatırımı
    earned: number                // Toplam kazanılan komisyon
    available: number             // Çekilebilir bakiye
    // Referral kullanıcı alanları (code kullanarak kayıt olan kullanıcılarda)
    referrer?: Types.ObjectId | null  // Partner'ın _id'si
    redeemedCode?: string | null      // Kullanıcının kullandığı kod
    referredAt?: Date | null
    pid?: boolean                 // Kod kullanıp kullanmadığı flag'i
    // Ortak
    bet: number
    deposit: number
  }
  stats?: {
    deposit?: number
    withdrawal?: number
    bet?: number
  }
  limits?: {
    blockAffiliate?: boolean
  }
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    name: String,
    username: String,
    phone: String,
    rank: { type: String, default: "user" },
    local: {
      email: String,
      password: String,
    },
    affiliates: {
      code: { type: String, default: null },
      referred: { type: Number, default: 0 },
      deposited: { type: Number, default: 0 },
      earned: { type: Number, default: 0 },
      available: { type: Number, default: 0 },
      referrer: { type: Schema.Types.ObjectId, ref: "User", default: null },
      redeemedCode: { type: String, default: null },
      referredAt: { type: Date, default: null },
      pid: { type: Boolean, default: false },
      bet: { type: Number, default: 0 },
      deposit: { type: Number, default: 0 },
    },
    stats: {
      deposit: { type: Number, default: 0 },
      withdrawal: { type: Number, default: 0 },
      bet: { type: Number, default: 0 },
    },
    limits: {
      blockAffiliate: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
)

// Prevent model recompilation in hot reload
export const UserModel =
  (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>("User", UserSchema)
