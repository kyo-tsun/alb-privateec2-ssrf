import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

export class PrivateSsmWithAlbStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    //define s3 bucket
    const bucket = new s3.Bucket(this, "Bucket", {
    });

    new s3deploy.BucketDeployment(this, "DeployInternalBucket", {
      sources: [s3deploy.Source.asset("./object")],
      destinationBucket: bucket
    });

    //define vpc with NAT Gateway
    const vpc = new ec2.Vpc(this, "PrivateSsmWithAlbVpc", {
      vpcName: "PrivateSsmWithAlbVpc",
      cidr: "10.0.0.0/16",
      natGateways: 1,
      maxAzs: 2
    });

    //define security group for ALB
    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc: vpc,
      securityGroupName: "AlbSecurityGroup",
      allowAllOutbound: false,
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    albSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80));

    //define security group for ec2
    const instanceSecurityGroup = new ec2.SecurityGroup(this, "PrivateSsmInstanceSecurityGroup", {
      vpc: vpc,
      securityGroupName: "PrivateSsmInstanceSecurityGroup",
      allowAllOutbound: false,
    });
    instanceSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(443));
    instanceSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    instanceSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    instanceSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80));
    
    // Allow ALB to communicate with EC2
    albSecurityGroup.connections.allowTo(instanceSecurityGroup, ec2.Port.tcp(80));

    //define iam role for ec2
    const instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
      ]
    });

    //上記で作成したS3バケットへのアクセスを許可
    bucket.grantReadWrite(instanceRole);


    //define user data for web server with vulnerable SSRF endpoint
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
      'yum update -y',
      'yum install -y httpd php',
      'systemctl enable httpd',
      'systemctl start httpd',
      'echo "<h1>Hello from EC2!</h1>" > /var/www/html/index.html',
      'echo "OK" > /var/www/html/healthcheck',
      // Create vulnerable PHP script for SSRF testing
      'cat > /var/www/html/fetch.php << "EOF"',
      '<?php',
      'if (isset($_GET["url"])) {',
      '    $url = $_GET["url"];',
      '    $content = file_get_contents($url);',
      '    echo $content;',
      '} else {',
      '    echo "Usage: fetch.php?url=<URL>";',
      '}',
      '?>',
      'EOF',
      'systemctl status httpd'
    );

    //define ec2 with IMDSv1 explicitly enabled
    const instance = new ec2.Instance(this, "PrivateSsmInstance", {
      vpc: vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023 }),
      securityGroup: instanceSecurityGroup,
      role: instanceRole,
      instanceName: "PrivateSsmInstance",
      requireImdsv2: false,
      userData: userData
    });

    // Explicitly configure IMDS to allow v1
    const cfnInstance = instance.node.defaultChild as ec2.CfnInstance;
    cfnInstance.metadataOptions = {
      httpEndpoint: 'enabled',
      httpTokens: 'optional',  // This allows both v1 and v2
      httpPutResponseHopLimit: 1,
      instanceMetadataTags: 'disabled'
    };

    


    //define security group for vpc endpoint
    const endpointSecurityGroup = new ec2.SecurityGroup(this, "PrivateSsmEndpointSecurityGroup", {
      vpc: vpc,
      securityGroupName: "PrivateSsmEndpointSecurityGroup",
      allowAllOutbound: false,
    });
    endpointSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(443));

    //define vpc endpoints
    new ec2.InterfaceVpcEndpoint(this, "SsmEndpoint", {
      vpc: vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      privateDnsEnabled: true,
      securityGroups: [endpointSecurityGroup],
    });

    new ec2.InterfaceVpcEndpoint(this, "SsmMessagesEndpoint", {
      vpc: vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      privateDnsEnabled: true,
      securityGroups: [endpointSecurityGroup],
    });

    new ec2.InterfaceVpcEndpoint(this, "Ec2MessagesEndpoint", {
      vpc: vpc,
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      privateDnsEnabled: true,
      securityGroups: [endpointSecurityGroup],
    });

    //define ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, "ApplicationLoadBalancer", {
      vpc: vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSecurityGroup,
      loadBalancerName: "PrivateSsmAlb"
    });

    //define target group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc: vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      targetGroupName: "PrivateSsmTargetGroup",
      healthCheck: {
        path: '/',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        protocol: elbv2.Protocol.HTTP,
        port: '80'
      }
    });
    
    targetGroup.addTarget(new targets.InstanceTarget(instance));

    //define listener
    alb.addListener("Listener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup]
    });

    //output ALB DNS name
    new CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "ALB DNS Name"
    });
  }
}