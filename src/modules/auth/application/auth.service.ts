import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../../user/application/user.service';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(private readonly users: UserService, private readonly jwt: JwtService) {}

  async register(input: { username: string; email: string; password: string }) {
    const user = await this.users.create(input);
    return this.issueToken(user.id, user.username, user.roles);
  }

  async login(username: string, password: string) {
    const user = await this.users.findByUsername(username);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await this.users.verifyPassword(user, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.issueToken(user.id, user.username, user.roles);
  }

  private issueToken(id: string, username: string, roles: string[]) {
    const payload: JwtPayload = { sub: id, username, roles };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id, username, roles },
    };
  }
}
