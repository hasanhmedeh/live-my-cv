import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ShopController } from './shop.controller.js';
import { ShopService } from './shop.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ShopController],
  providers: [ShopService],
})
export class ShopModule {}
