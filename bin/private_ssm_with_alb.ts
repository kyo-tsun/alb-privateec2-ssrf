#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PrivateSsmWithAlbStack } from '../lib/private_ssm_with_alb-stack';

const app = new cdk.App();
new PrivateSsmWithAlbStack(app, 'PrivateSsmWithAlbStack');
