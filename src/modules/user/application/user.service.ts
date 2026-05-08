import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from '../infrastructure/user.entity';
import { UserRole } from '../domain/user-role.enum';

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  roles?: UserRole[];
}

@Injectable()
export class UserService {
  constructor(@InjectRepository(UserEntity) private readonly repo: Repository<UserEntity>) {}

  async create(input: CreateUserInput): Promise<UserEntity> {
    const dupe = await this.repo.findOne({
      where: [{ username: input.username }, { email: input.email }],
    });
    if (dupe) throw new ConflictException('Username or email already in use');

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = this.repo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      roles: input.roles ?? [UserRole.AUTHOR],
    });
    return this.repo.save(user);
  }

  findById(id: string) {
    return this.repo.findOneBy({ id });
  }

  findByUsername(username: string) {
    return this.repo.findOneBy({ username });
  }

  async verifyPassword(user: UserEntity, plain: string) {
    return bcrypt.compare(plain, user.passwordHash);
  }

  async assertExists(id: string) {
    const u = await this.findById(id);
    if (!u) throw new NotFoundException(`User ${id} not found`);
    return u;
  }
}
