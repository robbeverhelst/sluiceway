// A CDK for Terraform app of two stacks, dev and prod, in plain JavaScript so
// that it runs without a build. It uses only terraform_data, which is built
// into OpenTofu and Terraform, so cdktf get has nothing to generate.
import cdktf from "cdktf";

const { App, TerraformStack, TerraformResource, TerraformVariable } = cdktf;

class Notes extends TerraformStack {
  constructor(scope, id, motd) {
    super(scope, id);
    // Marked sensitive, and still never shown by Sluiceway, marked or not.
    const secret = new TerraformVariable(this, "secret", {
      type: "string",
      sensitive: true,
      default: "CANARY-SECRET",
    });
    // Changes in place: a new input is an update.
    const config = new TerraformResource(this, "config", {
      terraformResourceType: "terraform_data",
    });
    config.addOverride("input", {
      greeting: motd,
      canary: "CANARY-VALUE",
      secret: secret.stringValue,
    });
  }
}

const app = new App();
new Notes(app, "dev", "hello");
new Notes(app, "prod", "hello");
app.synth();
