package controllers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.pcap4j.core.*;
import org.pcap4j.packet.EthernetPacket;
import org.pcap4j.packet.IpPacket;
import org.slf4j.Logger;
import play.libs.Json;
import play.libs.concurrent.HttpExecutionContext;
import play.mvc.Controller;
import play.mvc.LegacyWebSocket;
import play.mvc.Result;
import play.mvc.WebSocket;

import javax.inject.Inject;
import javax.inject.Singleton;
import java.util.concurrent.CompletableFuture;

public class HomeController extends Controller {

    private Logger logger = org.slf4j.LoggerFactory.getLogger("controllers.HomeController");

    private final HttpExecutionContext httpExecutionContext;

    @Inject
    public HomeController(HttpExecutionContext httpExecutionContext) {
        this.httpExecutionContext = httpExecutionContext;
    }

    public Result index() throws PcapNativeException, NotOpenException {
        return ok(views.html.index.render());
    }

    public LegacyWebSocket<JsonNode> socket() throws PcapNativeException {
        PcapHandle pcapHandle = openPcap();

        return WebSocket.whenReady((in, out) -> {
            Runnable r = () -> {
                pcapToSocket(pcapHandle, out);
            };
            CompletableFuture c = CompletableFuture.runAsync(r, httpExecutionContext.current());

            // For each event received on the socket,
            in.onMessage(System.out::println);
            // When the socket is closed.
            in.onClose(() -> {
                pcapHandle.close();
            });
        });
    }

    private PcapHandle openPcap() throws PcapNativeException {
        // TODO make config
        PcapNetworkInterface nif = Pcaps.getDevByName("wlp3s0");
        return nif.openLive(65536, PcapNetworkInterface.PromiscuousMode.PROMISCUOUS, 10);
    }

    private void pcapToSocket(PcapHandle pcapHandle, WebSocket.Out<JsonNode> out) {
        PacketListener listener = (packet) -> {
            if (packet != null) {
                ObjectNode outNode = Json.newObject().put("timestamp", pcapHandle.getTimestamp().toString());
                EthernetPacket ethernetPacket = packet.get(EthernetPacket.class);
                if (ethernetPacket != null) {
                    EthernetPacket.EthernetHeader header = ethernetPacket.getHeader();
                    outNode.put("macSrcAddr", header.getSrcAddr().toString());
                    outNode.put("macDstAddr", header.getDstAddr().toString());
                    outNode.put("macType", header.getType().valueAsString());
                }
                IpPacket ipPacket = packet.get(IpPacket.class);
                if (ipPacket != null) {
                    IpPacket.IpHeader header = ipPacket.getHeader();
                    outNode.put("ipSrcAddr", header.getSrcAddr().toString());
                    outNode.put("ipDstAddr", header.getDstAddr().toString());
                    outNode.put("ipProtocol", header.getProtocol().valueAsString());
                    outNode.put("ipVersion", header.getVersion().valueAsString());
                }
                out.write(outNode);
            }
        };

        try {
            pcapHandle.loop(1000, listener);
        } catch (InterruptedException e) {
            e.printStackTrace();
        } catch (PcapNativeException e) {
            e.printStackTrace();
        } catch (NotOpenException e) {
            e.printStackTrace();
        }
    }

}
